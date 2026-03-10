# Ark Server Deployment

This guide is the real remote-host path for Ark Web + API.

It is for the operator who wants to take a clean Linux server, deploy Ark from
this repo, and expose:

1. the public homepage
2. the consumer web surfaces
3. the enterprise and agent API
4. the local `managed_ark_key` commercial lane

## Deployment Shape

The remote host runs:

1. `ark-web`
   Next.js production container serving the homepage, `/open-source`,
   `/developers`, and all API routes
2. `postgres`
   durable run, tenant, usage, and credential storage
3. `redis`
   async job queue backend
4. `minio`
   artifact storage
5. `executor-fastapi`
   file and execution support service

Only the Ark web container is exposed publicly. The rest stay on the internal
Docker network.

## What The Deploy Script Does

Use the repo root command:

```bash
node scripts/deploy-remote-server.mjs --host <server-ip> --user root --password-env ARK_SERVER_PASSWORD --wipe
```

It will:

1. inspect the remote host
2. stop and clear old Docker workloads when `--wipe` is present
3. package the checked-out local repo state needed for server deployment
4. upload the bundle to the server
5. generate a managed-mode server env file
6. build and start the remote Docker Compose stack
7. write a local deployment report to `.moss/deployment/server-deploy-report.md`
8. write a local secret file to `.moss/deployment/server-deploy.local.json`

The local secret file contains the generated operator key for the deployed host.
Do not commit it.

## Required Local Inputs

The script reads provider and deployment values from:

1. `app/.env.local`
2. current shell environment

If those are empty, Ark still deploys, but provider-backed tools may be limited.

## Remote Smoke

After deployment, validate the public host with:

```bash
node scripts/smoke-remote-deployment.mjs --base-url http://<server-ip> --operator-key <managed-operator-key>
```

That smoke verifies:

1. homepage responds
2. `/open-source` responds
3. `/developers` responds
4. `/api/health` responds
5. `/api/v1/platform` responds
6. managed tenant creation works on the deployed host
7. tenant-facing Ark key execution works on the deployed host
8. key revocation is enforced immediately

## Server Layout

The default remote root is:

```text
/srv/ark
```

The deployed layout includes:

1. `/srv/ark/app`
2. `/srv/ark/infra`
3. `/srv/ark/services/executor-fastapi`
4. `/srv/ark/deploy/server.env`
5. `/srv/ark/.data/*` for persistent volumes

## Current Honest Boundary

This server path gives you:

1. public Ark site
2. public Ark API
3. self-operated `managed_ark_key` mode
4. tenant issuance, usage visibility, and tenant-key revoke/rotate

It does not yet claim:

1. hosted Ark SaaS billing
2. hosted multitenant backoffice
3. managed TLS/domain automation
4. fully hosted XHS bridge
