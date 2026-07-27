import { PromptTemplate } from './types';
import Mustache from 'mustache';

export class PromptManager {
  private templates = new Map<string, PromptTemplate>();

  constructor() {
    this.registerDefaultTemplates();
  }

  register(template: PromptTemplate) {
    this.templates.set(template.id, template);
  }

  render(id: string, vars: Record<string, any>) {
    const template = this.templates.get(id);
    if (!template) throw new Error(`Prompt template ${id} not found`);
    return Mustache.render(template.template, vars);
  }

  private registerDefaultTemplates() {
    this.register({
      id: 'analysis',
      name: 'Analysis',
      category: 'analysis',
      template: 'Analyze {{symbol}} with {{mode}} focus. Provide a concise recommendation and confidence score.',
      variables: ['symbol', 'mode'],
    });
    this.register({
      id: 'consensus',
      name: 'Consensus',
      category: 'consensus',
      template: 'Compare the following provider outputs for {{symbol}} and produce a single recommendation with confidence.',
      variables: ['symbol'],
    });
    this.register({
      id: 'fallback',
      name: 'Fallback',
      category: 'fallback',
      template: 'The primary provider failed. Use the fallback provider and explain the change for {{symbol}}.',
      variables: ['symbol'],
    });
  }
}

export default PromptManager;
