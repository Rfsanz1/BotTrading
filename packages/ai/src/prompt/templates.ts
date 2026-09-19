import mustache from 'mustache';

export function renderTemplate(template: string, vars: Record<string, any>) {
  return mustache.render(template, vars);
}

export function compilePrompt(template: string) {
  // return a function for reuse
  return (vars: Record<string, any>) => mustache.render(template, vars);
}

export default { renderTemplate, compilePrompt };
