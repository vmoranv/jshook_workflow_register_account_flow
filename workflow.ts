type RetryPolicy = {
  maxAttempts: number;
  backoffMs: number;
  multiplier?: number;
};

type WorkflowExecutionContext = {
  workflowRunId: string;
  profile: string;
  invokeTool(toolName: string, args: Record<string, unknown>): Promise<unknown>;
  emitSpan(name: string, attrs?: Record<string, unknown>): void;
  emitMetric(
    name: string,
    value: number,
    type: 'counter' | 'gauge' | 'histogram',
    attrs?: Record<string, unknown>,
  ): void;
  getConfig<T = unknown>(path: string, fallback?: T): T;
};

type ToolNode = {
  kind: 'tool';
  id: string;
  toolName: string;
  input?: Record<string, unknown>;
  timeoutMs?: number;
  retry?: RetryPolicy;
};

type SequenceNode = {
  kind: 'sequence';
  id: string;
  steps: WorkflowNode[];
};

type BranchNode = {
  kind: 'branch';
  id: string;
  predicateId: string;
  predicateFn?: (ctx: WorkflowExecutionContext) => boolean | Promise<boolean>;
  whenTrue: WorkflowNode;
  whenFalse?: WorkflowNode;
};

type WorkflowNode = ToolNode | SequenceNode | BranchNode;

type WorkflowContract = {
  kind: 'workflow-contract';
  version: 1;
  id: string;
  displayName: string;
  description?: string;
  tags?: string[];
  timeoutMs?: number;
  defaultMaxConcurrency?: number;
  build(ctx: WorkflowExecutionContext): WorkflowNode;
  onStart?(ctx: WorkflowExecutionContext): Promise<void> | void;
  onFinish?(ctx: WorkflowExecutionContext, result: unknown): Promise<void> | void;
  onError?(ctx: WorkflowExecutionContext, error: Error): Promise<void> | void;
};

function toolNode(
  id: string,
  toolName: string,
  options?: { input?: Record<string, unknown>; retry?: RetryPolicy; timeoutMs?: number },
): ToolNode {
  return {
    kind: 'tool',
    id,
    toolName,
    input: options?.input,
    retry: options?.retry,
    timeoutMs: options?.timeoutMs,
  };
}

function sequenceNode(id: string, steps: WorkflowNode[]): SequenceNode {
  return { kind: 'sequence', id, steps };
}

function branchNode(
  id: string,
  predicateId: string,
  whenTrue: WorkflowNode,
  whenFalse: WorkflowNode | undefined,
  predicateFn?: (ctx: WorkflowExecutionContext) => boolean | Promise<boolean>,
): BranchNode {
  return { kind: 'branch', id, predicateId, predicateFn, whenTrue, whenFalse };
}

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
    const verificationLinkPattern = ctx.getConfig<string>(
      `${prefix}.verificationLinkPattern`,
      '/api/v1/auths/activate',
    );
    const timeoutMs = ctx.getConfig<number>(`${prefix}.timeoutMs`, 90_000);
    const authMinConfidence = ctx.getConfig<number>(`${prefix}.authMinConfidence`, 0.3);
    const emailPollingWaitMs = ctx.getConfig<number>(`${prefix}.emailPollingWaitMs`, 6000);

    const username = ctx.getConfig<string>(`${prefix}.username`, 'demo-user');
    const email = ctx.getConfig<string>(`${prefix}.email`, 'demo@example.com');
    const password = ctx.getConfig<string>(`${prefix}.password`, 'DemoPassword123!');
    const includeConfirmPassword = ctx.getConfig<boolean>(`${prefix}.includeConfirmPassword`, true);
    const confirmPasswordFieldName = ctx.getConfig<string>(
      `${prefix}.confirmPasswordFieldName`,
      'checkPassword',
    );
    const extraFields = ctx.getConfig<Record<string, unknown>>(`${prefix}.extraFields`, {});
    const enableTermsCheckbox = ctx.getConfig<boolean>(`${prefix}.enableTermsCheckbox`, false);
    const termsSelector = ctx.getConfig<string>(`${prefix}.termsSelector`, "input[type='checkbox']");
    const checkboxSelectors = ctx.getConfig<string[]>(
      `${prefix}.checkboxSelectors`,
      enableTermsCheckbox && termsSelector ? [termsSelector] : [],
    );

    const fields: Record<string, unknown> = {
      username,
      email,
      password,
      ...extraFields,
    };
    if (includeConfirmPassword) {
      fields[confirmPasswordFieldName] = password;
    }

    const fillSteps: WorkflowNode[] = Object.entries(fields).map(([name, value]) =>
      toolNode(`type-${name}`, 'page_type', {
        input: {
          selector: `input[name='${name}']`,
          text: String(value),
          delay: 20,
        },
      }),
    );

    const checkboxSteps: WorkflowNode[] = checkboxSelectors.map((selector, index) =>
      toolNode(`checkbox-${index + 1}`, 'page_evaluate', {
        input: {
          code: `(function(){const cb=document.querySelector(${JSON.stringify(selector)});if(!cb)return false;cb.click();if('checked' in cb){cb.checked=true;}cb.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`,
        },
      }),
    );

    const verificationBranch = branchNode(
      'maybe-email-verification',
      'register_account_email_verification_enabled',
      sequenceNode('email-verification-sequence', [
        toolNode('navigate-email-provider', 'page_navigate', {
          input: {
            url: emailProviderUrl,
            waitUntil: 'networkidle',
            enableNetworkMonitoring: true,
          },
        }),
        toolNode('wait-email-poll', 'page_evaluate', {
          input: {
            code: `new Promise(resolve => setTimeout(() => resolve({ waitedMs: ${emailPollingWaitMs} }), ${emailPollingWaitMs}))`,
          },
          timeoutMs: Math.max(10_000, emailPollingWaitMs + 2_000),
        }),
        toolNode('open-latest-mail', 'page_evaluate', {
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
        }),
        toolNode('wait-mail-detail', 'page_evaluate', {
          input: {
            code: 'new Promise(resolve => setTimeout(() => resolve({ waitedMs: 1500 }), 1500))',
          },
          timeoutMs: 10_000,
        }),
        toolNode('open-verification-link', 'page_evaluate', {
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
        }),
        toolNode('wait-verification-finish', 'page_evaluate', {
          input: {
            code: 'new Promise(resolve => setTimeout(() => resolve({ waitedMs: 2500 }), 2500))',
          },
          timeoutMs: 10_000,
        }),
      ]),
      toolNode('skip-email-verification', 'console_execute', {
        input: {
          expression: '({ skipped: true, step: "email_verification", reason: "config_disabled" })',
        },
      }),
      () => Boolean(emailProviderUrl),
    );

    return sequenceNode('register-account-flow-root', [
      toolNode('enable-network', 'network_enable', {
        input: { enableExceptions: true },
      }),
      toolNode('navigate-register-page', 'page_navigate', {
        input: {
          url: registerUrl,
          waitUntil: 'networkidle',
          enableNetworkMonitoring: true,
        },
      }),
      toolNode('wait-first-field', 'page_wait_for_selector', {
        input: {
          selector: `input[name='${Object.keys(fields)[0] ?? 'email'}']`,
          timeout: 15000,
        },
      }),
      sequenceNode('fill-form', fillSteps),
      sequenceNode('click-checkboxes', checkboxSteps),
      toolNode('submit-registration-form', 'page_click', {
        input: { selector: submitSelector },
      }),
      toolNode('wait-after-submit', 'page_evaluate', {
        input: {
          code: 'new Promise(resolve => setTimeout(() => resolve({ waitedMs: 2000 }), 2000))',
        },
        timeoutMs: 10_000,
      }),
      toolNode('extract-auth-findings', 'network_extract_auth', {
        input: { minConfidence: authMinConfidence },
      }),
      verificationBranch,
      toolNode('registration-summary', 'console_execute', {
        input: {
          expression: `(${JSON.stringify({
            status: 'registration_flow_complete',
            registerUrl,
            email,
            emailProviderUrl,
            verificationLinkPattern,
          })})`,
        },
      }),
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
