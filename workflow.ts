import {
  branchNode,
  sequenceNode,
  toolNode,
} from '@jshookmcp/extension-sdk/workflow';
import type { WorkflowContract } from '@jshookmcp/extension-sdk/workflow';

const workflow: WorkflowContract = {
  kind: 'workflow-contract',
  version: 1,
  id: 'workflow.register-account-flow.v1',
  displayName: 'Register Account Flow',
  description:
    'Fill a registration form, submit it, extract auth artifacts, and optionally verify by email.',
  tags: ['workflow', 'registration', 'auth', 'verification', 'automation'],
  timeoutMs: 10 * 60_000,
  defaultMaxConcurrency: 1,

  build(ctx) {
    const prefix = 'workflows.registerAccount';

    const registerUrl = ctx.getConfig<string>(
      `${prefix}.registerUrl`,
      'https://example.com/register',
    );
    const username = ctx.getConfig<string>(`${prefix}.username`, 'demo-user');
    const email = ctx.getConfig<string>(`${prefix}.email`, 'demo@example.com');
    const password = ctx.getConfig<string>(`${prefix}.password`, '{{PLACEHOLDER}}');
    const submitSelector = ctx.getConfig<string>(
      `${prefix}.submitSelector`,
      "button[type='submit']",
    );
    const enableTermsCheckbox = ctx.getConfig<boolean>(
      `${prefix}.enableTermsCheckbox`,
      false,
    );
    const termsSelector = ctx.getConfig<string>(
      `${prefix}.termsSelector`,
      "input[type='checkbox']",
    );
    const emailProviderUrl = ctx.getConfig<string>(`${prefix}.emailProviderUrl`, '');
    const verificationLinkPattern = ctx.getConfig<string>(
      `${prefix}.verificationLinkPattern`,
      '/auth',
    );
    const timeoutMs = ctx.getConfig<number>(`${prefix}.timeoutMs`, 60_000);
    const emailPollingWaitMs = Math.max(2_000, Math.min(timeoutMs, 10_000));

    const fillForm = sequenceNode('fill-form', [
      toolNode('type-username', 'page_type', {
        input: {
          selector: "input[name='username']",
          text: username,
          delay: 20,
        },
      }),
      toolNode('type-email', 'page_type', {
        input: {
          selector: "input[name='email']",
          text: email,
          delay: 20,
        },
      }),
      toolNode('type-password', 'page_type', {
        input: {
          selector: "input[name='password']",
          text: password,
          delay: 20,
        },
      }),
    ]);

    const maybeTermsCheckbox = branchNode(
      'maybe-terms-checkbox',
      'register_account_enable_terms_checkbox',
      toolNode('activate-terms-checkbox', 'page_evaluate', {
        input: {
          code: `(function(){const cb=document.querySelector(${JSON.stringify(termsSelector)});if(!cb)return false;cb.click();cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`,
        },
      }),
      toolNode('skip-terms-checkbox', 'console_execute', {
        input: {
          expression: '({ skipped: "terms_checkbox" })',
        },
      }),
      () => enableTermsCheckbox && Boolean(termsSelector),
    );

    const waitAfterSubmit = toolNode('wait-after-submit', 'page_evaluate', {
      input: {
        code: 'new Promise(resolve => setTimeout(() => resolve({ waitedMs: 2000 }), 2000))',
      },
    });

    const maybeEmailVerification = branchNode(
      'maybe-email-verification',
      'register_account_enable_email_verification',
      sequenceNode('email-verification-sequence', [
        toolNode('bind-register-tab', 'tab_workflow', {
          input: {
            action: 'alias_bind',
            alias: 'register',
            index: 0,
          },
        }),
        toolNode('open-email-provider-tab', 'tab_workflow', {
          input: {
            action: 'alias_open',
            alias: 'emailTab',
            url: emailProviderUrl,
          },
        }),
        toolNode('wait-before-email-scan', 'page_evaluate', {
          input: {
            code: `new Promise(resolve => setTimeout(() => resolve({ waitedMs: ${emailPollingWaitMs} }), ${emailPollingWaitMs}))`,
          },
        }),
        toolNode('transfer-verification-link', 'tab_workflow', {
          input: {
            action: 'transfer',
            fromAlias: 'emailTab',
            key: '__verificationLink',
            expression: `(function(){const links=Array.from(document.querySelectorAll('a'));const l=links.find(a => (a.href || '').includes(${JSON.stringify(verificationLinkPattern)}));return l ? l.href : null;})()`,
          },
        }),
        toolNode('read-verification-link', 'tab_workflow', {
          input: {
            action: 'context_get',
            key: '__verificationLink',
          },
        }),
      ]),
      toolNode('skip-email-verification', 'console_execute', {
        input: {
          expression: '({ skipped: "email_verification" })',
        },
      }),
      () => Boolean(emailProviderUrl),
    );

    const summary = toolNode('registration-summary', 'console_execute', {
      input: {
        expression:
          '({ status: "registration_flow_complete", capturedAuth: true, emailVerificationBranchEvaluated: true })',
      },
    });

    return sequenceNode('register-account-flow-root', [
      toolNode('enable-network', 'network_enable', {
        input: { enableExceptions: true },
      }),
      toolNode('navigate-register-page', 'page_navigate', {
        input: {
          url: registerUrl,
          waitUntil: 'domcontentloaded',
          enableNetworkMonitoring: true,
        },
      }),
      fillForm,
      maybeTermsCheckbox,
      toolNode('submit-registration-form', 'page_click', {
        input: { selector: submitSelector },
      }),
      waitAfterSubmit,
      toolNode('extract-auth-findings', 'network_extract_auth', {
        input: { minConfidence: 0.3 },
      }),
      maybeEmailVerification,
      summary,
    ]);
  },

  onStart(ctx) {
    ctx.emitMetric('workflow_runs_total', 1, 'counter', {
      workflowId: 'workflow.register-account-flow.v1',
      stage: 'start',
    });
  },

  onFinish(ctx) {
    ctx.emitMetric('workflow_runs_total', 1, 'counter', {
      workflowId: 'workflow.register-account-flow.v1',
      stage: 'finish',
    });
  },

  onError(ctx, error) {
    ctx.emitMetric('workflow_errors_total', 1, 'counter', {
      workflowId: 'workflow.register-account-flow.v1',
      error: error.name,
    });
  },
};

export default workflow;
