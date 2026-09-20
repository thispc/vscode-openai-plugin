# Security

- No provider API keys, tokens, or private OAuth credentials are stored by this extension.
- Provider authentication remains in the official local CLI (for example, its own OS credential store).
- Extension-owned secrets, if added later, must use `ExtensionContext.secrets` (`SecretStorage`), never settings, source files, or logs.
- Commands are spawned without a shell and prompts are passed as arguments, reducing command-injection risk.
- Output may contain sensitive user/project data; the output channel is local and is not uploaded.
- Review configured executable paths and workspace trust before running tasks.
