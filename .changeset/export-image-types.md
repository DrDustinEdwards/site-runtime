---
"@dustinedwards/site-runtime": patch
---

The types a function returns are exported from the entry point that exports the function: `ImagesLike`, `ImagesOutput` and `R2ObjectLike` from `./image`; `CheckResult` from `./check`; `ChainKey` and `ChainCheck` from `./audit-log`; `CronRun` from `./cron`; `AcquireDecision` from `./cron-lock`; `CacheableMethod` and `ToolListProblem` from `./mcp-server`; `Hit` and `Verdict` from `./rate-limit`; `PatternRule`, `ProseIssue`, `VoiceReading`, `Profile`, `Spread` and `SlopFinding` from `./prose`; `AccountFormState` from `./sign-in-form`; `AccountPasskey`, `NoticeDetail`, `SecurityHistoryEntry`, `SessionLookup` and `AuthEvent` from `./sign-in-account`. They lived in modules the package does not export, so a project with a composite tsconfig failed to typecheck (TS2883) when it kept the result.
