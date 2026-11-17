// 可插拔的大模型提供方。
//  * claude  —— 官方 @anthropic-ai/sdk（可选依赖：npm install 后可用）
//  * openai  —— 任何 OpenAI 兼容接口：DeepSeek、通义千问、Kimi、智谱、Ollama、vLLM……
// 每个 provider 只需实现 complete({system, user, schema}) -> 字符串(JSON)。

export class ClaudeProvider {
  constructor({ model, effort } = {}) {
    this.name = 'claude';
    this.model = model || process.env.MA_CLAUDE_MODEL || 'claude-opus-5-5';
    // 回合制对话以低延迟为主；可用 MA_CLAUDE_EFFORT=medium/high 提高推理深度
    this.effort = effort || process.env.MA_CLAUDE_EFFORT || 'low';
  }

  async client() {
    if (!this._client) {
      let mod;
      try { mod = await import('@anthropic-ai/sdk'); } catch {
        throw new Error('未安装 @anthropic-ai/sdk，请先运行 npm install');
      }
      const Anthropic = mod.default;
      this._client = new Anthropic();
    }
    return this._client;
  }

  async complete({ system, user, schema }) {
    const client = await this.client();
    const response = await client.beta.messages.create({
      model: this.model,
      max_tokens: 8000,
      // 遇到安全分类器误拒时，由服务端自动切换到合适的后备模型
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { effort: this.effort, format: { type: 'json_schema', schema } },
    });
    if (response.stop_reason === 'refusal') throw new Error(`模型拒绝回答: ${response.stop_details?.category || ''}`);
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { text, usage: { input: response.usage?.input_tokens || 0, output: response.usage?.output_tokens || 0 }, model: response.model };
  }
}

export class OpenAICompatProvider {
  constructor({ baseUrl, apiKey, model } = {}) {
    this.name = 'openai';
    this.baseUrl = (baseUrl || process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '');
    this.apiKey = apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.model = model || process.env.OPENAI_MODEL || 'deepseek-chat';
  }

  async complete({ system, user }) {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        response_format: { type: 'json_object' },
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`OpenAI 兼容接口返回 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return {
      text: data.choices?.[0]?.message?.content || '',
      usage: { input: data.usage?.prompt_tokens || 0, output: data.usage?.completion_tokens || 0 },
      model: data.model || this.model,
    };
  }
}

/** 当前环境下可用的智能体类型（前端大厅据此显示选项）。 */
export async function availableProviders(lang = 'zh') {
  const z = lang === 'en' ? (zh, en) => en : (zh) => zh;
  const list = [{ id: 'rule', name: z('规则型 AI（离线，免费）', 'Rule-based AI (offline, free)'), ready: true }];
  let sdk = false;
  try { await import('@anthropic-ai/sdk'); sdk = true; } catch { /* 未安装 */ }
  const claudeKey = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);
  list.push({
    id: 'claude', name: `Claude（${process.env.MA_CLAUDE_MODEL || 'claude-opus-5-5'}）`, ready: sdk && claudeKey,
    hint: !sdk ? z('运行 npm install 安装 @anthropic-ai/sdk', 'Run npm install to install @anthropic-ai/sdk') : (!claudeKey ? z('设置 ANTHROPIC_API_KEY', 'Set ANTHROPIC_API_KEY') : ''),
  });
  const oaReady = !!(process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL);
  list.push({
    id: 'openai', name: z(`OpenAI 兼容（${process.env.OPENAI_MODEL || 'deepseek-chat'}）`, `OpenAI-compatible (${process.env.OPENAI_MODEL || 'deepseek-chat'})`), ready: oaReady,
    hint: oaReady ? '' : z('设置 OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL（DeepSeek、通义千问、Kimi、Ollama 等）', 'Set OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL (DeepSeek, Qwen, Kimi, Ollama, ...)'),
  });
  return list;
}

export function makeProvider(id, opts = {}) {
  if (id === 'claude') return new ClaudeProvider(opts);
  if (id === 'openai') return new OpenAICompatProvider(opts);
  throw new Error(`未知的模型提供方 ${id}`);
}
