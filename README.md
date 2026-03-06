# register-account-flow workflow

Declarative workflow for account registration: open a registration page, fill standard fields, submit the form, extract auth findings, and optionally coordinate email verification through shared tab context.

## Entry File

- `workflow.ts`

## Workflow ID

- `workflow.register-account-flow.v1`

## Structure

This workflow mirrors the built-in `handleRegisterAccountFlow` logic as a declarative graph:

- `network_enable` before navigation for request/error capture
- `page_navigate` to the registration page
- `page_type` steps for `username`, `email`, and `password`
- Optional checkbox activation via `page_evaluate`
- `page_click` to submit the form
- `page_evaluate` delay step to allow registration requests to settle
- `network_extract_auth` to collect token/auth findings
- Optional `tab_workflow` branch to open an email tab and transfer the verification URL into shared context
- `console_execute` summary step for downstream automation

## Tools Used

- `network_enable`
- `page_navigate`
- `page_type`
- `page_evaluate`
- `page_click`
- `network_extract_auth`
- `tab_workflow`
- `console_execute`

## Config

- `workflows.registerAccount.registerUrl`
- `workflows.registerAccount.username`
- `workflows.registerAccount.email`
- `workflows.registerAccount.password`
- `workflows.registerAccount.submitSelector`
- `workflows.registerAccount.enableTermsCheckbox`
- `workflows.registerAccount.termsSelector`
- `workflows.registerAccount.emailProviderUrl`
- `workflows.registerAccount.verificationLinkPattern`
- `workflows.registerAccount.timeoutMs`

## Notes

- The email-verification branch stores the discovered URL under shared key `__verificationLink`.
- A downstream runner can read that context value and decide whether to navigate, verify, or hand off to another workflow.
- If `emailProviderUrl` is empty, the verification branch is skipped.

## Local Validation

1. Run `pnpm install`.
2. Run `pnpm typecheck`.
3. Put this repo under a configured `workflows/` extension root.
4. Run `extensions_reload` in `jshookmcp`.
5. Confirm the workflow appears in `extensions_list`.
6. Execute the workflow and verify registration, auth extraction, and optional verification-link transfer.
