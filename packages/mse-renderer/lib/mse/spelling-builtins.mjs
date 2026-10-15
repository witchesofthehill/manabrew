import { MseError } from './document.mjs';
import { boolean, text } from './script-values.mjs';

// The provider uses the language dictionary by default. A third argument asks
// for the package's supplemental dictionary with that language's affix rules.
export function spellingBuiltins({ spellcheck, spellcheckEnabled = true } = {}) {
  const spell = (word, language, dictionary) => {
    if (!spellcheck) throw new MseError('script-spelling-provider', 'A dictionary-backed spelling provider is required');
    const result = spellcheck(word, language, dictionary);
    if (typeof result !== 'boolean') throw new MseError('script-spelling-provider', 'Spelling provider must return a boolean synchronously');
    return result;
  };
  return {
    check_spelling_word: scope => {
      const language = text(scope.get('language'));
      return !language || spell(text(scope.get('input')), language);
    },
    check_spelling: (scope, runtime, node) => {
      let source = text(scope.get('input'));
      if (!spellcheckEnabled) return source;
      source = source.replace(/<\/?error-spelling[^>]*(?:>|$)/g, '');
      const language = text(scope.get('language'));
      if (!language) return source;
      const dictionary = scope.has('extra_dictionary') ? text(scope.get('extra_dictionary')) : '';
      const extra = scope.has('extra_match') ? scope.get('extra_match') : null;
      const tag = `error-spelling:${language}${dictionary ? ':' + dictionary : ''}`;
      let output = '', start = -1, unchecked = 0, check = true;
      const appendWord = end => {
        if (start < 0 || start >= end) return;
        const tagged = source.slice(start, end);
        const word = tagged.replace(/<[^>]*(?:>|$)/g, '').replaceAll('\u0001', '<');
        const good = !check || !word || spell(word, language)
          || (dictionary && spell(word, language, dictionary))
          || (extra && (boolean(runtime.invoke(extra, [['input', word]], scope, node))
            || boolean(runtime.invoke(extra, [['input', tagged]], scope, node))));
        output += good ? tagged : `<${tag}>${tagged}</${tag}>`;
      };
      for (let pos = 0; pos < source.length;) {
        runtime.tick(node);
        if (source[pos] === '<') {
          const end = source.indexOf('>', pos);
          const after = end < 0 ? source.length : end + 1;
          const tagText = source.slice(pos, after);
          if (/^<(nospellcheck|sym|atom)(?=[>\-: ])/.test(tagText)) unchecked++;
          else if (/^<\/(nospellcheck|sym|atom)(?=[>\-: ])/.test(tagText)) unchecked--;
          if (start < 0) output += tagText;
          pos = after;
        } else {
          const char = String.fromCodePoint(source.codePointAt(pos));
          if (/[\p{L}'’]/u.test(char)) {
            if (start < 0) start = pos;
            if (unchecked > 0) check = false;
          } else {
            appendWord(pos);
            start = -1;
            check = unchecked <= 0;
            output += char;
          }
          pos += char.length;
        }
      }
      appendWord(source.length);
      return output;
    },
  };
}
