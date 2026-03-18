import sanitizeHtml from 'sanitize-html';

/**
 * Sanitiza texto de entrada del usuario
 * Remueve HTML, scripts, y caracteres peligrosos
 */
export function sanitizeInput(input: string): string {
  if (!input) return input;

  return sanitizeHtml(input, {
    allowedTags: [],        // No permitir ningún HTML
    allowedAttributes: {},  // No permitir atributos
    disallowedTagsMode: 'recursiveEscape',
  }).trim();
}
