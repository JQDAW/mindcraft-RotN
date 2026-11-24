import OpenAIApi from 'openai';
import { getKey, hasKey } from '../utils/keys.js';
import { strictFormat } from '../utils/text.js';
import { safeError } from '../agent/safe_error.js';

// One line per completion with its token counts and cost in USD (G4 #7 soak): numbers only, never the body.
// OpenRouter always includes usage (prompt_tokens, completion_tokens, cost in USD credits) on Chat Completions.
// "unknown" when OpenRouter sent no usage or a field is not a finite non-negative number.
export function usageLine(usage) {
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0) ? String(v) : 'unknown';
    return `[openrouter] usage prompt_tokens ${num(usage?.prompt_tokens)}, completion_tokens ${num(usage?.completion_tokens)}, cost_usd ${num(usage?.cost)}`;
}

// The hidden reasoning share of completion_tokens (soak 7: 5.2 times the completion tokens of soak 6 for
// about the same text). Its own line, so the harness's usage-line pattern stays as it is. null (no line)
// when OpenRouter sent no completion_tokens_details at all.
export function reasoningLine(usage) {
    const d = usage?.completion_tokens_details;
    if (!d || typeof d !== 'object') return null;
    const v = d.reasoning_tokens;
    const n = (typeof v === 'number' && Number.isFinite(v) && v >= 0) ? String(v) : 'unknown';
    return `[openrouter] reasoning_tokens ${n}`;
}

// The reasoning object as one short log token (field=value pairs, safe characters only).
export function reasoningSetting(r) {
    return Object.entries(r ?? {}).map(([k, v]) => `${k}=${v}`).join(',').replace(/[^\w=,.-]/g, '?').slice(0, 60) || 'none';
}

export class OpenRouter {
    static prefix = 'openrouter';
    constructor(model_name, url) {
        this.model_name = model_name;

        let config = {};
        config.baseURL = url || 'https://openrouter.ai/api/v1';

        const apiKey = getKey('OPENROUTER_API_KEY');
        if (!apiKey) {
            console.error('Error: OPENROUTER_API_KEY not found. Make sure it is set properly.');
        }

        // Pass the API key to OpenAI compatible Api
        config.apiKey = apiKey; 

        this.openai = new OpenAIApi(config);
    }

    // Soak 13 (rotn-v0.1.19, usd_per_hour 0.0552 against 0.05): memory summaries were 42% of the spend, up to
    // 18,312 reasoning tokens for about 500 characters. `reasoning` (opts) asks OpenRouter for that reasoning
    // setting on this call only (promptMemSaving: { effort: 'none' }, OpenRouter's documented "disables
    // reasoning entirely"). A model whose reasoning is mandatory rejects effort none: a 4xx on a call that
    // carried `reasoning` (400, 404 or 422) is retried once without it; if that retry works, later calls send none.
    async sendRequest(turns, systemMessage, stop_seq='*', { reasoning = null } = {}) {
        let messages = [{ role: 'system', content: systemMessage }, ...turns];
        messages = strictFormat(messages);

        // Choose a valid model from openrouter.ai (for example, "openai/gpt-4o")
        const pack = {
            model: this.model_name,
            messages,
        };
        // A null or empty stop_seq sends no stop sequence at all (memory summaries).
        if (stop_seq) pack.stop = stop_seq;
        if (reasoning && !this.reasoningRefused) {
            pack.reasoning = reasoning;
            console.log(`[openrouter] reasoning ${reasoningSetting(reasoning)} for this call`);
        }

        let res = null;
        try {
            console.log('Awaiting openrouter api response...');
            let completion;
            try {
                completion = await this.openai.chat.completions.create(pack);
            } catch (err) {
                // Only the statuses a refused parameter gives (400, 404 "no endpoints for these
                // parameters", 422); the SDK already retries 408/409/429/5xx itself.
                const status = Number(err?.status);
                if (!pack.reasoning || ![400, 404, 422].includes(status)) throw err;
                console.error(`[openrouter] the reasoning setting may have been refused (status ${status}); retrying without it`);
                delete pack.reasoning;
                completion = await this.openai.chat.completions.create(pack);
                // The retry worked without it: the setting was the cause, so later calls send none (said once).
                this.reasoningRefused = true;
                console.error('[openrouter] the retry without the reasoning setting worked; sending none from now on');
            }
            // One line per completion for the G3 harness's per-provider counts:
            // provider name, finish reason and content length only, never the body.
            const c0 = completion?.choices?.[0];
            const clean = (v, d) => String(v ?? d).replace(/[^\w .-]/g, '?').slice(0, 40);
            const provider = clean(completion?.provider, 'unknown');
            console.log(`[openrouter] provider ${provider}, finish_reason ${clean(c0?.finish_reason, 'none')}, content ${typeof c0?.message?.content === 'string' ? c0.message.content.length : 'null'} chars`);
            console.log(usageLine(completion?.usage));
            const reasoning = reasoningLine(completion?.usage);
            if (reasoning) console.log(reasoning);
            if (!completion?.choices?.[0]) {
                // Never the whole response body; only its error summary, if any.
                console.error(`No completion or choices returned (model ${this.model_name}):`, completion?.error ? safeError(completion.error) : 'no choices in the response');
                return 'No response received.';
            }
            if (completion.choices[0].finish_reason === 'length') {
                throw new Error('Context length exceeded');
            }
            res = completion.choices[0].message?.content;
            if (typeof res !== 'string' || res.trim() === '') {
                // A reasoning model can answer with reasoning only and null content
                // (G3 smoke round 5 A: history.js crashed on null). Treat it as no reply.
                console.error(`Empty content returned (model ${this.model_name}, finish_reason ${completion.choices[0].finish_reason ?? 'none'})`);
                return 'No response received.';
            }
            console.log('Received.');
        } catch (err) {
            // A safe summary; the SDK error object carries request headers and the response body.
            console.error('Error while awaiting response:', safeError(err));
            // If the error indicates a context-length problem, we can slice the turns array, etc.
            res = 'My brain disconnected, try again.';
        }
        return res;
    }

    async sendVisionRequest(messages, systemMessage, imageBuffer) {
        const imageMessages = [...messages];
        imageMessages.push({
            role: "user",
            content: [
                { type: "text", text: systemMessage },
                {
                    type: "image_url",
                    image_url: {
                        url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`
                    }
                }
            ]
        });
        
        return this.sendRequest(imageMessages, systemMessage);
    }

    async embed(text) {
        throw new Error('Embeddings are not supported by Openrouter.');
    }
}