import type { WorkflowContract } from '@jshookmcp/extension-sdk/workflow';
import { toolNode, sequenceNode, branchNode } from '@jshookmcp/extension-sdk/workflow';

const workflow: WorkflowContract = {
  kind: 'workflow-contract',
  version: 1,
  id: 'workflow.register-account-flow.v1',
  displayName: 'Register Account Flow',
  description:
    'Register via page automation, capture auth artifacts, and optionally perform single-tab email verification without tab_workflow.',
  tags: ['workflow', 'registration', 'auth', 'verification', 'automation'],
  timeoutMs: 10 * 60_000,
  defaultMaxConcurrency: 1,

  build(ctx) {
    const prefix = 'workflows.registerAccount';
    const registerUrl = ctx.getConfig<string>(`${prefix}.registerUrl`, 'https://example.com/register');
    const submitSelector = ctx.getConfig<string>(`${prefix}.submitSelector`, "button[type='submit']");
    const emailProviderUrl = ctx.getConfig<string>(`${prefix}.emailProviderUrl`, '');
    const verificationLinkPattern = ctx.getConfig<string>(`${prefix}.verificationLinkPattern`, '/api/v1/auths/activate');
    const timeoutMs = ctx.getConfig<number>(`${prefix}.timeoutMs`, 90_000);
    const authMinConfidence = ctx.getConfig<number>(`${prefix}.authMinConfidence`, 0.3);
    const emailPollingWaitMs = ctx.getConfig<number>(`${prefix}.emailPollingWaitMs`, 6000);

    const username = ctx.getConfig<string>(`${prefix}.username`, 'demo-user');
    const email = ctx.getConfig<string>(`${prefix}.email`, 'demo@example.com');
    const password = ctx.getConfig<string>(`${prefix}.password`, 'DemoPassword123!');
    const includeConfirmPassword = ctx.getConfig<boolean>(`${prefix}.includeConfirmPassword`, true);
    const confirmPasswordFieldName = ctx.getConfig<string>(`${prefix}.confirmPasswordFieldName`, 'checkPassword');
    const extraFields = ctx.getConfig<Record<string, unknown>>(`${prefix}.extraFields`, {});
    const enableTermsCheckbox = ctx.getConfig<boolean>(`${prefix}.enableTermsCheckbox`, false);
    const termsSelector = ctx.getConfig<string>(`${prefix}.termsSelector`, "input[type='checkbox']");
    const checkboxSelectors = ctx.getConfig<string[]>(
      `${prefix}.checkboxSelectors`,
      enableTermsCheckbox && termsSelector ? [termsSelector] : [],
    );

    const fields: Record<string, unknown> = { username, email, password, ...extraFields };
    if (includeConfirmPassword) fields[confirmPasswordFieldName] = password;

    const fillForm = sequenceNode('fill-form');
    for (const [name, value] of Object.entries(fields)) {
      fillForm.step(toolNode(`type-${name}`, 'page_type').input({
        selector: `input[name='${name}']`, text: String(value), delay: 20,
      }));
    }

    const clickCheckboxes = sequenceNode('click-checkboxes');
    checkboxSelectors.forEach((selector, index) => {
      clickCheckboxes.step(toolNode(`checkbox-${index + 1}`, 'page_evaluate').input({
        code: `(function(){const cb=document.querySelector(${JSON.stringify(selector)});if(!cb)return false;cb.click();if('checked' in cb){cb.checked=true;}cb.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`,
      }));
    });

    const verificationBranch = branchNode('maybe-email-verification', 'register_account_email_verification_enabled')
      .predicateFn(() => Boolean(emailProviderUrl))
      .whenTrue(sequenceNode('email-verification-sequence')
        .step(toolNode('navigate-email-provider', 'page_navigate').input({ url: emailProviderUrl, waitUntil: 'networkidle', enableNetworkMonitoring: true }))
        .step(toolNode('wait-email-poll', 'page_evaluate')
          .input({ code: `new Promise(resolve => setTimeout(() => resolve({ waitedMs: ${emailPollingWaitMs} }), ${emailPollingWaitMs}))` })
          .timeout(Math.max(10_000, emailPollingWaitMs + 2_000)))
        .step(toolNode('open-latest-mail', 'page_evaluate').input({
          code: `(function(){
            const anchors = Array.from(document.querySelectorAll('#message-list a'));
            const view = anchors.find(a => (a.getAttribute('href') || '').includes('/mail/view/'));
            if (!view) return { success: false, step: 'open-latest-mail' };
            const href = view.href || view.getAttribute('href');
            if (!href) return { success: false, step: 'open-latest-mail', reason: 'empty-href' };
            window.location.href = href;
            return { success: true, step: 'open-latest-mail', href };
          })()`,
        }))
        .step(toolNode('wait-mail-detail', 'page_evaluate')
          .input({ code: 'new Promise(resolve => setTimeout(() => resolve({ waitedMs: 1500 }), 1500))' })
          .timeout(10_000))
        .step(toolNode('open-verification-link', 'page_evaluate').input({
          code: `(function(){
            const links = Array.from(document.querySelectorAll('a'));
            const match = links.find(a => (a.href || '').includes(${JSON.stringify(verificationLinkPattern)}));
            if (!match) return { success: false, step: 'open-verification-link' };
            const href = match.href || match.getAttribute('href');
            if (!href) return { success: false, step: 'open-verification-link', reason: 'empty-href' };
            window.location.href = href;
            return { success: true, step: 'open-verification-link', href };
          })()`,
        }))
        .step(toolNode('wait-verification-finish', 'page_evaluate')
          .input({ code: 'new Promise(resolve => setTimeout(() => resolve({ waitedMs: 2500 }), 2500))' })
          .timeout(10_000)))
      .whenFalse(toolNode('skip-email-verification', 'console_execute').input({
        expression: '({ skipped: true, step: "email_verification", reason: "config_disabled" })',
      }));

    return sequenceNode('register-account-flow-root')
      .step(toolNode('enable-network', 'network_enable').input({ enableExceptions: true }))
      .step(toolNode('navigate-register-page', 'page_navigate').input({ url: registerUrl, waitUntil: 'networkidle', enableNetworkMonitoring: true }))
      .step(toolNode('wait-first-field', 'page_wait_for_selector').input({
        selector: `input[name='${Object.keys(fields)[0] ?? 'email'}']`, timeout: 15000,
      }))
      .step(fillForm)
      .step(clickCheckboxes)
      .step(toolNode('submit-registration-form', 'page_click').input({ selector: submitSelector }))
      .step(toolNode('wait-after-submit', 'page_evaluate')
        .input({ code: 'new Promise(resolve => setTimeout(() => resolve({ waitedMs: 2000 }), 2000))' })
        .timeout(10_000))
      .step(toolNode('extract-auth-findings', 'network_extract_auth').input({ minConfidence: authMinConfidence }))
      .step(verificationBranch)
      .step(toolNode('registration-summary', 'console_execute').input({
        expression: `(${JSON.stringify({ status: 'registration_flow_complete', registerUrl, email, emailProviderUrl, verificationLinkPattern })})`,
      }))
      .build();
  },

  onStart(ctx) {
    ctx.emitMetric('workflow_runs_total', 1, 'counter', { workflowId: 'workflow.register-account-flow.v1', stage: 'start' });
  },

  onFinish(ctx) {
    ctx.emitMetric('workflow_runs_total', 1, 'counter', { workflowId: 'workflow.register-account-flow.v1', stage: 'finish' });
  },

  onError(ctx, error) {
    ctx.emitMetric('workflow_errors_total', 1, 'counter', { workflowId: 'workflow.register-account-flow.v1', error: error.name });
  },
};

export default workflow;
