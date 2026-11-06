import OpenAIApi from 'openai';
import { getKey, hasKey } from '../utils/keys.js';
import { strictFormat } from '../utils/text.js';
import { safeError } from '../agent/safe_error.js';

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

    async sendRequest(turns, systemMessage, stop_seq='*') {
        let messages = [{ role: 'system', content: systemMessage }, ...turns];
        messages = strictFormat(messages);

        // Choose a valid model from openrouter.ai (for example, "openai/gpt-4o")
        const pack = {
            model: this.model_name,
            messages,
            stop: stop_seq
        };

        let res = null;
        try {
            console.log('Awaiting openrouter api response...');
            let completion = await this.openai.chat.completions.create(pack);
            // One line per completion for the G3 harness's per-provider counts:
            // provider name, finish reason and content length only, never the body.
            const c0 = completion?.choices?.[0];
            const provider = String(completion?.provider ?? 'unknown').replace(/[^\w .-]/g, '?').slice(0, 40);
            console.log(`[openrouter] provider ${provider}, finish_reason ${c0?.finish_reason ?? 'none'}, content ${typeof c0?.message?.content === 'string' ? c0.message.content.length : 'null'} chars`);
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