import ts from 'typescript';

/**
 * Finds user-facing literals in a TSX file (T-172): JSX text with a letter in it, a string literal placed directly in
 * JSX (`{'Connected'}`), and a literal on an attribute a person reads or hears. Copy belongs in the catalog
 * (`apps/web/messages`); the no-literal check (`no-literals.test.ts`) holds every file to zero, or to no more than its
 * recorded baseline.
 */
const READ_ATTRIBUTES = new Set(['title', 'label', 'placeholder', 'aria-label', 'alt', 'description', 'hint', 'centerLabel', 'summary', 'heading']);
const LETTER = /\p{L}/u;

export interface Literal {
  readonly line: number;
  readonly text: string;
}

export function findLiterals(source: string, fileName = 'file.tsx'): Literal[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Literal[] = [];
  const add = (node: ts.Node, text: string) => {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (LETTER.test(clean)) found.push({ line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, text: clean });
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) add(node, node.text);
    else if (ts.isJsxExpression(node) && node.expression && (ts.isStringLiteral(node.expression) || ts.isNoSubstitutionTemplateLiteral(node.expression)) && !ts.isJsxAttribute(node.parent)) {
      add(node, node.expression.text);
    } else if (ts.isJsxAttribute(node) && READ_ATTRIBUTES.has(node.name.getText(file)) && node.initializer) {
      const init = node.initializer;
      if (ts.isStringLiteral(init)) add(node, init.text);
      else if (ts.isJsxExpression(init) && init.expression && (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression))) add(node, init.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}
