import argparse
import json
import os
import posixpath
import tarfile
import tempfile
from pathlib import Path

import paramiko


EXCLUDED_NAMES = {
    ".git",
    ".next",
    "node_modules",
    "target",
    "__pycache__",
    ".moss",
    ".data",
    "test-screenshots",
    "review-screenshots",
    ".claude",
}

EXCLUDED_SUFFIXES = {".pyc", ".pyo", ".log"}


def should_exclude(path: Path) -> bool:
    for part in path.parts:
        if part in EXCLUDED_NAMES:
            return True
    if path.name.endswith(".local"):
        return True
    if path.name.endswith(".local.json"):
        return True
    if path.suffix.lower() in EXCLUDED_SUFFIXES:
        return True
    return False


def create_bundle(repo_root: Path, bundle_path: Path) -> None:
    include_roots = [
        repo_root / "app",
        repo_root / "infra",
        repo_root / "services" / "executor-fastapi",
    ]
    with tarfile.open(bundle_path, "w:gz") as tar:
        for include_root in include_roots:
            if not include_root.exists():
                continue
            for current_root, dirnames, filenames in os.walk(include_root):
                current_root = Path(current_root)
                rel_root = current_root.relative_to(repo_root)
                dirnames[:] = [
                    dirname
                    for dirname in dirnames
                    if not should_exclude(rel_root / dirname)
                ]
                for filename in filenames:
                    rel = rel_root / filename
                    if should_exclude(rel):
                        continue
                    source = current_root / filename
                    tar.add(source, arcname=rel.as_posix())


def ssh_exec(client: paramiko.SSHClient, command: str, timeout: int = 1200):
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    out = stdout.read().decode("utf-8", "ignore")
    err = stderr.read().decode("utf-8", "ignore")
    status = stdout.channel.recv_exit_status()
    return {"command": command, "status": status, "stdout": out, "stderr": err}


def upload_file(sftp: paramiko.SFTPClient, local_path: Path, remote_path: str):
    remote_dir = posixpath.dirname(remote_path)
    mkdirs(sftp, remote_dir)
    sftp.put(str(local_path), remote_path)


def mkdirs(sftp: paramiko.SFTPClient, remote_dir: str):
    parts = []
    current = remote_dir
    while current not in ("", "/"):
        parts.append(current)
        current = posixpath.dirname(current)
    for directory in reversed(parts):
        try:
            sftp.stat(directory)
        except OSError:
            sftp.mkdir(directory)


def inventory(client: paramiko.SSHClient):
    commands = [
        "hostname",
        "uname -a",
        "cat /etc/os-release || true",
        "df -h",
        "docker ps -a || true",
        "docker volume ls || true",
        "ls -la /root || true",
        "ls -la /srv || true",
        "ss -ltnp || true",
    ]
    return [ssh_exec(client, command, timeout=120) for command in commands]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", required=True)
    parser.add_argument("--user", default="root")
    parser.add_argument("--password", required=True)
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--remote-root", default="/srv/ark")
    parser.add_argument("--env-file", required=True)
    parser.add_argument("--wipe", action="store_true")
    args = parser.parse_args()

    repo_root = Path(args.repo_root)
    env_file = Path(args.env_file)

    with tempfile.TemporaryDirectory(prefix="ark-remote-deploy-") as tmp_dir:
        bundle_path = Path(tmp_dir) / "ark-server-bundle.tar.gz"
        create_bundle(repo_root, bundle_path)

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(
            hostname=args.host,
            username=args.user,
            password=args.password,
            timeout=20,
        )

        report = {
            "host": args.host,
            "remote_root": args.remote_root,
            "inventory_before": inventory(client),
        }

        cleanup_commands = []
        if args.wipe:
            cleanup_commands = [
                "docker ps -aq | xargs -r docker rm -f",
                "docker system prune -af --volumes || true",
                "rm -rf /srv/ark /opt/ark /root/ark /root/prompt_platform /root/portainer_data",
            ]
            report["cleanup"] = [ssh_exec(client, command, timeout=1800) for command in cleanup_commands]
        else:
            report["cleanup"] = []

        sftp = client.open_sftp()
        remote_bundle = "/tmp/ark-server-bundle.tar.gz"
        remote_env = posixpath.join(args.remote_root, "deploy", "server.env")
        upload_file(sftp, bundle_path, remote_bundle)
        upload_file(sftp, env_file, remote_env)
        sftp.close()

        deploy_commands = [
            f"mkdir -p {args.remote_root}",
            f"tar -xzf {remote_bundle} -C {args.remote_root}",
            f"docker compose --env-file {remote_env} -f {args.remote_root}/infra/docker-compose.server.yml down --remove-orphans || true",
            f"docker compose --env-file {remote_env} -f {args.remote_root}/infra/docker-compose.server.yml up -d --build",
            f"docker compose --env-file {remote_env} -f {args.remote_root}/infra/docker-compose.server.yml ps",
        ]
        report["deploy"] = [ssh_exec(client, command, timeout=3600) for command in deploy_commands]
        report["inventory_after"] = inventory(client)
        client.close()

        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
