# Security Policy

## Supported Use

Ark is designed to be self-hosted. Operators are responsible for their own
provider keys, storage, and runtime isolation.

## Reporting A Vulnerability

Do not open a public GitHub issue for secrets, auth bypasses, sandbox escapes, or
credential leaks.

Instead:

1. Prepare a minimal reproduction
2. Include affected commit or file path
3. Describe whether the issue exposes local files, provider credentials, or remote execution
4. Share the report privately with your project maintainers

## Response Guidelines

When triaging a report:

1. Revoke any exposed credentials immediately
2. Remove secrets from logs, screenshots, and attachments
3. Patch the issue before publishing details
4. Add regression coverage when possible

## Public Safety

Never commit:

1. Real `.env.local` files
2. Browser cookies
3. OAuth client secrets
4. Provider API keys
5. Internal-only URLs or infrastructure addresses
