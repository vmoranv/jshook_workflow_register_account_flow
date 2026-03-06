# register-account-flow workflow

Declarative workflow for account registration, auth/token capture, and optional email verification.

## Entry File

- `workflow.ts`

## Workflow ID

- `workflow.register-account-flow.v1`

## Structure

This workflow mirrors the built-in `register_account_flow` handler with declarative nodes:

- `network_enable` for request/error capture
- `page_navigate` to the registration page
- `page_type` steps for `username` / `email` / `password`
- Optional checkbox activation via `page_evaluate`
- `page_click` for form submission
- Promise-based wait via `page_evaluate`
- `network_extract_auth` for token discovery
- Optional email verification using `tab_workflow`
- `console_execute` summary output

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

- The workflow retrieves the verification link into shared tab context via `tab_workflow`.
- A follow-up runner can read `__verificationLink` and decide whether to navigate or hand it to a downstream step.
- If `emailProviderUrl` is empty, the email verification branch is skipped.

## Local Validation

1. Put this repo under a configured `workflows/` extension root.
2. Run `extensions_reload` in `jshookmcp`.
3. Confirm the workflow appears in `extensions_list`.
4. Trigger the workflow from your workflow runner and verify registration, auth extraction, and optional verification steps.
