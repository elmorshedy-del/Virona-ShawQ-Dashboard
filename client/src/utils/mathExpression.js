function normalizeMathInput(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .replace(/[×✕]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[%$£€]/g, '')
    .replace(/[,_\u00A0\s]/g, '')
    .trim();
}

function tokenizeMathExpression(expression) {
  const tokens = [];
  let i = 0;

  const isDigit = (char) => char >= '0' && char <= '9';
  const isOperator = (char) => char === '+' || char === '-' || char === '*' || char === '/' || char === '^';

  while (i < expression.length) {
    const char = expression[i];
    if (char === '(' || char === ')') {
      tokens.push({ type: 'paren', value: char });
      i += 1;
      continue;
    }

    if (isOperator(char)) {
      tokens.push({ type: 'op', value: char });
      i += 1;
      continue;
    }

    if (isDigit(char) || char === '.') {
      const start = i;
      i += 1;
      while (i < expression.length) {
        const next = expression[i];
        if (isDigit(next) || next === '.') {
          i += 1;
          continue;
        }
        if ((next === 'e' || next === 'E') && i + 1 < expression.length) {
          const afterE = expression[i + 1];
          const afterE2 = expression[i + 2];
          if (isDigit(afterE) || afterE === '+' || afterE === '-') {
            i += 2;
            if (afterE2 && isDigit(afterE2)) {
              i += 1;
            }
            continue;
          }
        }
        break;
      }
      const rawNumber = expression.slice(start, i);
      const value = Number(rawNumber);
      tokens.push({ type: 'num', value });
      continue;
    }

    return null;
  }

  return tokens;
}

export function evaluateMathExpression(expression) {
  const cleaned = normalizeMathInput(expression);
  if (!cleaned) return NaN;
  if (!/^[0-9eE+\-*/().^]+$/.test(cleaned)) return NaN;

  const tokens = tokenizeMathExpression(cleaned);
  if (!tokens) return NaN;

  const precedence = { 'u-': 4, '^': 3, '*': 2, '/': 2, '+': 1, '-': 1 };
  const rightAssociative = { '^': true, 'u-': true };

  const output = [];
  const stack = [];
  let prevType = 'start';

  for (const token of tokens) {
    if (token.type === 'num') {
      if (!Number.isFinite(token.value)) return NaN;
      output.push(token);
      prevType = 'num';
      continue;
    }

    if (token.type === 'paren') {
      if (token.value === '(') {
        stack.push(token);
        prevType = 'paren_open';
      } else {
        while (stack.length && stack[stack.length - 1].type !== 'paren') {
          output.push(stack.pop());
        }
        if (!stack.length) return NaN;
        stack.pop();
        prevType = 'paren_close';
      }
      continue;
    }

    if (token.type === 'op') {
      const isUnary = (token.value === '-' || token.value === '+') && (prevType === 'start' || prevType === 'op' || prevType === 'paren_open');
      if (isUnary && token.value === '+') {
        prevType = 'op';
        continue;
      }

      const opToken = isUnary ? { type: 'op', value: 'u-' } : token;
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.type !== 'op') break;
        const pTop = precedence[top.value] ?? 0;
        const pCur = precedence[opToken.value] ?? 0;
        const shouldPop = rightAssociative[opToken.value]
          ? pCur < pTop
          : pCur <= pTop;
        if (!shouldPop) break;
        output.push(stack.pop());
      }
      stack.push(opToken);
      prevType = 'op';
      continue;
    }

    return NaN;
  }

  while (stack.length) {
    const token = stack.pop();
    if (token.type === 'paren') return NaN;
    output.push(token);
  }

  const valueStack = [];
  for (const token of output) {
    if (token.type === 'num') {
      valueStack.push(token.value);
      continue;
    }
    if (token.type !== 'op') return NaN;

    if (token.value === 'u-') {
      if (valueStack.length < 1) return NaN;
      valueStack.push(-valueStack.pop());
      continue;
    }

    if (valueStack.length < 2) return NaN;
    const right = valueStack.pop();
    const left = valueStack.pop();

    let next;
    if (token.value === '+') next = left + right;
    else if (token.value === '-') next = left - right;
    else if (token.value === '*') next = left * right;
    else if (token.value === '/') next = left / right;
    else if (token.value === '^') next = Math.pow(left, right);
    else return NaN;

    valueStack.push(next);
  }

  if (valueStack.length !== 1) return NaN;
  return valueStack[0];
}

export function parseCalculatorNumber(raw) {
  return evaluateMathExpression(raw);
}

