import {
  branchStep,
  defineWorkflow,
  sequenceStep,
  toolStep,
  type WorkflowExecutionContext,
} from '@jshookmcp/extension-sdk/workflow';

const workflowId = 'workflow.register-account-flow.v1';

export default defineWorkflow(workflowId, 'Register Account Flow', (workflow) =>
  workflow
    .description(
      'Register via page automation, capture auth artifacts, and optionally perform single-tab email verification without tab_workflow.',
    )
    .tags(['workflow', 'registration', 'auth', 'verification', 'automation'])
    .timeoutMs(10 * 60_000)
    .defaultMaxConcurrency(1)
    .buildGraph((ctx: WorkflowExecutionContext) => {
      const prefix = 'workflows.registerAccount';
      const registerUrl = ctx.getConfig<string>(
        `${prefix}.registerUrl`,
        'https://example.com/register',
      );
      const submitSelector = ctx.getConfig<string>(
        `${prefix}.submitSelector`,
        "button[type='submit']",
      );
      const emailProviderUrl = ctx.getConfig<string>(`${prefix}.emailProviderUrl`, '');
      const verificationLinkPattern = ctx.getConfig<string>(
        `${prefix}.verificationLinkPattern`,
        '/api/v1/auths/activate',
      );
      const authMinConfidence = ctx.getConfig<number>(`${prefix}.authMinConfidence`, 0.3);
      const emailPollingWaitMs = ctx.getConfig<number>(`${prefix}.emailPollingWaitMs`, 6000);

      const username = ctx.getConfig<string>(`${prefix}.username`, 'demo-user');
      const email = ctx.getConfig<string>(`${prefix}.email`, 'demo@example.com');
      const password = ctx.getConfig<string>(`${prefix}.password`, 'DemoPassword123!');
      const includeConfirmPassword = ctx.getConfig<boolean>(
        `${prefix}.includeConfirmPassword`,
        true,
      );
      const confirmPasswordFieldName = ctx.getConfig<string>(
        `${prefix}.confirmPasswordFieldName`,
        'checkPassword',
      );
      const extraFields = ctx.getConfig<Record<string, unknown>>(`${prefix}.extraFields`, {});
      const enableTermsCheckbox = ctx.getConfig<boolean>(`${prefix}.enableTermsCheckbox`, false);
      const termsSelector = ctx.getConfig<string>(
        `${prefix}.termsSelector`,
        "input[type='checkbox']",
      );
      const checkboxSelectors = ctx.getConfig<string[]>(
        `${prefix}.checkboxSelectors`,
        enableTermsCheckbox && termsSelector ? [termsSelector] : [],
      );

      const fields: Record<string, unknown> = { username, email, password, ...extraFields };
      if (includeConfirmPassword) {
        fields[confirmPasswordFieldName] = password;
      }

      const fillForm = sequenceStep('fill-form', (step) => {
        for (const [name, value] of Object.entries(fields)) {
          step.tool(`type-${name}`, 'page_type', {
            input: {
              selector: `input[name='${name}']`,
              text: String(value),
              delay: 20,
            },
          });
        }
      });

      const clickCheckboxes = sequenceStep('click-checkboxes', (step) => {
        checkboxSelectors.forEach((selector, index) => {
          step.tool(`checkbox-${index + 1}`, 'page_evaluate', {
            input: {
              code: `(function(){const cb=document.querySelector(${JSON.stringify(selector)});if(!cb)return false;cb.click();if('checked' in cb){cb.checked=true;}cb.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`,
            },
          });
        });
      });

      const verificationBranch = branchStep(
        'maybe-email-verification',
        'register_account_email_verification_enabled',
        (branch) => {
          branch
            .predicateFn(() => Boolean(emailProviderUrl))
            .whenTrue(
              sequenceStep('email-verification-sequence', (sequence) => {
                sequence.tool('navigate-email-provider', 'page_navigate', {
                  input: {
                    url: emailProviderUrl,
                    waitUntil: 'networkidle',
                    enableNetworkMonitoring: true,
                  },
                });
                sequence.tool('wait-email-poll', 'page_evaluate', {
                  input: {
                    code: `new Promise(resolve => setTimeout(() => resolve({ waitedMs: ${emailPollingWaitMs} }), ${emailPollingWaitMs}))`,
                  },
                  timeoutMs: Math.max(10_000, emailPollingWaitMs + 2_000),
                });
                sequence.tool('open-latest-mail', 'page_evaluate', {
                  input: {
                    code: `(function(){
                      const anchors = Array.from(document.querySelectorAll('#message-list a'));
                      const view = anchors.find(a => (a.getAttribute('href') || '').includes('/mail/view/'));
                      if (!view) return { success: false, step: 'open-latest-mail' };
                      const href = view.href || view.getAttribute('href');
                      if (!href) return { success: false, step: 'open-latest-mail', reason: 'empty-href' };
                      window.location.href = href;
                      return { success: true, step: 'open-latest-mail', href };
                    })()`,
                  },
                });
                sequence.tool('wait-mail-detail', 'page_evaluate', {
                  input: {
                    code: 'new Promise(resolve => setTimeout(() => resolve({ waitedMs: 1500 }), 1500))',
                  },
                  timeoutMs: 10_000,
                });
                sequence.tool('open-verification-link', 'page_evaluate', {
                  input: {
                    code: `(function(){
                      const links = Array.from(document.querySelectorAll('a'));
                      const match = links.find(a => (a.href || '').includes(${JSON.stringify(verificationLinkPattern)}));
                      if (!match) return { success: false, step: 'open-verification-link' };
                      const href = match.href || match.getAttribute('href');
                      if (!href) return { success: false, step: 'open-verification-link', reason: 'empty-href' };
                      window.location.href = href;
                      return { success: true, step: 'open-verification-link', href };
                    })()`,
                  },
                });
                sequence.tool('wait-verification-finish', 'page_evaluate', {
                  input: {
                    code: 'new Promise(resolve => setTimeout(() => resolve({ waitedMs: 2500 }), 2500))',
                  },
                  timeoutMs: 10_000,
                });
              }),
            )
            .whenFalse(
              toolStep('skip-email-verification', 'console_execute', {
                input: {
                  expression:
                    '({ skipped: true, step: "email_verification", reason: "config_disabled" })',
                },
              }),
            );
        },
      );

      return sequenceStep('register-account-flow-root', (root) => {
        root.tool('enable-network', 'network_enable', {
          input: { enableExceptions: true },
        });
        root.tool('navigate-register-page', 'page_navigate', {
          input: {
            url: registerUrl,
            waitUntil: 'networkidle',
            enableNetworkMonitoring: true,
          },
        });
        root.tool('wait-first-field', 'page_wait_for_selector', {
          input: {
            selector: `input[name='${Object.keys(fields)[0] ?? 'email'}']`,
            timeout: 15_000,
          },
        });
        root.step(fillForm);
        root.step(clickCheckboxes);
        root.tool('submit-registration-form', 'page_click', {
          input: { selector: submitSelector },
        });
        root.tool('wait-after-submit', 'page_evaluate', {
          input: {
            code: 'new Promise(resolve => setTimeout(() => resolve({ waitedMs: 2000 }), 2000))',
          },
          timeoutMs: 10_000,
        });
        root.tool('extract-auth-findings', 'network_extract_auth', {
          input: { minConfidence: authMinConfidence },
        });
        root.step(verificationBranch);
        root.tool('registration-summary', 'console_execute', {
          input: {
            expression: `(${JSON.stringify({
              status: 'registration_flow_complete',
              registerUrl,
              email,
              emailProviderUrl,
              verificationLinkPattern,
            })})`,
          },
        });
      });
    })
    .onStart((ctx) => {
      ctx.emitMetric('workflow_runs_total', 1, 'counter', { workflowId, stage: 'start' });
    })
    .onFinish((ctx) => {
      ctx.emitMetric('workflow_runs_total', 1, 'counter', { workflowId, stage: 'finish' });
    })
    .onError((ctx, error) => {
      ctx.emitMetric('workflow_errors_total', 1, 'counter', { workflowId, error: error.name });
    }),
);
