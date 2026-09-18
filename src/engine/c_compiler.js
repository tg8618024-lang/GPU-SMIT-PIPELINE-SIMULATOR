// ──────────────────────────────────────────────────────────────────────────────
// SIMT-Flow: Micro-C In-Browser Mini Compiler
// ──────────────────────────────────────────────────────────────────────────────
// Parses a lightweight subset of C (variables, arithmetic, arrays, if/else,
// for loops, while loops) and emits cycle-accurate Micro-ISA assembly code.
// ──────────────────────────────────────────────────────────────────────────────

export function compileCToAssembly(sourceCode) {
    const lines = sourceCode.split('\n');
    const asm = [];
    let labelCount = 0;
    
    // Register allocation pool: R1..R6 (R0 is zero, R7 reserved for temp/addr)
    const varMap = {}; // varName -> register index (1..6)
    const arrayMap = {}; // arrayName -> { baseAddr, length }
    let nextReg = 1;
    let nextMemAddr = 64; // Arrays allocated starting at memory offset 64

    asm.push('; ──────────────────────────────────────────────────────────────────');
    asm.push('; Compiled from Micro-C by SIMT-Flow In-Browser Compiler');
    asm.push('; ──────────────────────────────────────────────────────────────────');

    function allocReg(name) {
        if (varMap[name] !== undefined) return varMap[name];
        if (nextReg > 6) {
            throw new Error(`Register allocation limit exceeded: Maximum 6 local integer variables (R1-R6).`);
        }
        const reg = nextReg++;
        varMap[name] = reg;
        return reg;
    }

    // Tokenizer
    function cleanCode(code) {
        // Strip block comments and line comments
        return code
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '')
            .trim();
    }

    const clean = cleanCode(sourceCode);
    if (!clean) {
        return '; Empty C program\nHALT';
    }

    // Simple statement-level parser
    // Normalize statements by semicolons and brace blocks
    const stmts = splitStatements(clean);

    for (const stmt of stmts) {
        compileStatement(stmt.trim());
    }

    asm.push('HALT  ; Program Termination');
    return asm.join('\n');

    function splitStatements(code) {
        const statements = [];
        let cur = '';
        let braceDepth = 0;

        for (let i = 0; i < code.length; i++) {
            const ch = code[i];
            if (ch === '{') braceDepth++;
            if (ch === '}') braceDepth--;
            cur += ch;

            if (braceDepth === 0) {
                if (ch === ';' || ch === '}') {
                    statements.push(cur.trim());
                    cur = '';
                }
            }
        }
        if (cur.trim()) statements.push(cur.trim());
        return statements;
    }

    function compileStatement(stmt) {
        if (!stmt) return;

        // 1. Array declaration: int arr[4] = {10, 20, 30, 40};
        const arrMatch = stmt.match(/^int\s+([a-zA-Z_]\w*)\s*\[\s*(\d*)\s*\]\s*=\s*\{([^}]+)\};?$/);
        if (arrMatch) {
            const name = arrMatch[1];
            const vals = arrMatch[3].split(',').map(s => parseInt(s.trim()));
            const baseAddr = nextMemAddr;
            nextMemAddr += vals.length;
            arrayMap[name] = { baseAddr, length: vals.length };

            asm.push(`; Array initialization: int ${name}[${vals.length}] at Mem[${baseAddr}]`);
            vals.forEach((v, idx) => {
                const addr = baseAddr + idx;
                asm.push(`ADDI R7, R0, ${v}`);
                asm.push(`ST   [R0 + ${addr}], R7`);
            });
            return;
        }

        // 2. Variable declaration with init: int x = 5;
        const varDeclMatch = stmt.match(/^int\s+([a-zA-Z_]\w*)\s*=\s*(.+);?$/);
        if (varDeclMatch) {
            const name = varDeclMatch[1];
            const expr = varDeclMatch[2].replace(/;$/, '').trim();
            const reg = allocReg(name);
            compileExpression(expr, reg, name);
            return;
        }

        // 3. Variable declaration without init: int x;
        const varOnlyMatch = stmt.match(/^int\s+([a-zA-Z_]\w*);?$/);
        if (varOnlyMatch) {
            const name = varOnlyMatch[1];
            const reg = allocReg(name);
            asm.push(`ADDI R${reg}, R0, 0   ; int ${name} = 0;`);
            return;
        }

        // 4. For loop: for (int i = 0; i < N; i++) { ... }
        const forMatch = stmt.match(/^for\s*\(\s*(.*?)\s*;\s*(.*?)\s*;\s*(.*?)\s*\)\s*\{([\s\S]*)\}$/);
        if (forMatch) {
            const init = forMatch[1];
            const cond = forMatch[2];
            const step = forMatch[3];
            const body = forMatch[4];

            const loopId = ++labelCount;
            const startLabel = `for_loop_${loopId}`;
            const endLabel = `for_end_${loopId}`;

            asm.push(`; --- For Loop Start ---`);
            if (init) compileStatement(init + ';');

            asm.push(`${startLabel}:`);
            compileConditionBranch(cond, endLabel);

            // Loop body
            const bodyStmts = splitStatements(body);
            for (const bs of bodyStmts) {
                compileStatement(bs);
            }

            // Step
            if (step) compileStatement(step + ';');
            asm.push(`J    ${startLabel}`);
            asm.push(`${endLabel}:`);
            asm.push(`; --- For Loop End ---`);
            return;
        }

        // 5. While loop: while (cond) { ... }
        const whileMatch = stmt.match(/^while\s*\(\s*(.*?)\s*\)\s*\{([\s\S]*)\}$/);
        if (whileMatch) {
            const cond = whileMatch[1];
            const body = whileMatch[2];

            const loopId = ++labelCount;
            const startLabel = `while_loop_${loopId}`;
            const endLabel = `while_end_${loopId}`;

            asm.push(`; --- While Loop Start ---`);
            asm.push(`${startLabel}:`);
            compileConditionBranch(cond, endLabel);

            const bodyStmts = splitStatements(body);
            for (const bs of bodyStmts) {
                compileStatement(bs);
            }

            asm.push(`J    ${startLabel}`);
            asm.push(`${endLabel}:`);
            asm.push(`; --- While Loop End ---`);
            return;
        }

        // 6. If / Else: if (cond) { ... } else { ... }
        const ifElseMatch = stmt.match(/^if\s*\(\s*(.*?)\s*\)\s*\{([\s\S]*?)\}(?:\s*else\s*\{([\s\S]*?)\})?$/);
        if (ifElseMatch) {
            const cond = ifElseMatch[1];
            const thenBody = ifElseMatch[2];
            const elseBody = ifElseMatch[3];

            const ifId = ++labelCount;
            const elseLabel = `if_else_${ifId}`;
            const endLabel = `if_end_${ifId}`;

            asm.push(`; --- If Statement ---`);
            compileConditionBranch(cond, elseBody ? elseLabel : endLabel);

            const thenStmts = splitStatements(thenBody);
            for (const ts of thenStmts) compileStatement(ts);

            if (elseBody) {
                asm.push(`J    ${endLabel}`);
                asm.push(`${elseLabel}:`);
                const elseStmts = splitStatements(elseBody);
                for (const es of elseStmts) compileStatement(es);
            }

            asm.push(`${endLabel}:`);
            return;
        }

        // 7. Increment/Decrement: i++; or i--;
        const incMatch = stmt.match(/^([a-zA-Z_]\w*)(\+\+|--);?$/);
        if (incMatch) {
            const name = incMatch[1];
            const op = incMatch[2];
            const reg = varMap[name];
            if (reg === undefined) throw new Error(`Undeclared identifier '${name}'`);
            if (op === '++') {
                asm.push(`ADDI R${reg}, R${reg}, 1   ; ${name}++`);
            } else {
                asm.push(`ADDI R${reg}, R${reg}, -1  ; ${name}--`);
            }
            return;
        }

        // 8. Array element assignment: arr[i] = expr;
        const arrAssignMatch = stmt.match(/^([a-zA-Z_]\w*)\s*\[\s*(.+?)\s*\]\s*=\s*(.+);?$/);
        if (arrAssignMatch) {
            const arrName = arrAssignMatch[1];
            const idxExpr = arrAssignMatch[2];
            const valExpr = arrAssignMatch[3].replace(/;$/, '').trim();

            const arrInfo = arrayMap[arrName];
            if (!arrInfo) throw new Error(`Undeclared array '${arrName}'`);

            // Compute value into R7
            compileExpression(valExpr, 7, 'temp_val');
            // Compute index
            if (/^\d+$/.test(idxExpr)) {
                const constAddr = arrInfo.baseAddr + parseInt(idxExpr);
                asm.push(`ST   [R0 + ${constAddr}], R7 ; ${arrName}[${idxExpr}] = ...`);
            } else if (varMap[idxExpr] !== undefined) {
                const idxReg = varMap[idxExpr];
                asm.push(`ADDI R6, R${idxReg}, ${arrInfo.baseAddr} ; Address of ${arrName}[${idxExpr}]`);
                asm.push(`ST   [R6 + 0], R7`);
            }
            return;
        }

        // 9. Compound assignment: x += expr;
        const compoundMatch = stmt.match(/^([a-zA-Z_]\w*)\s*(\+=|-=|\*=)\s*(.+);?$/);
        if (compoundMatch) {
            const name = compoundMatch[1];
            const op = compoundMatch[2];
            const expr = compoundMatch[3].replace(/;$/, '').trim();
            const reg = varMap[name];
            if (reg === undefined) throw new Error(`Undeclared identifier '${name}'`);

            compileExpression(expr, 7, 'compound_temp');
            if (op === '+=') asm.push(`ADD  R${reg}, R${reg}, R7 ; ${name} += ...`);
            if (op === '-=') asm.push(`SUB  R${reg}, R${reg}, R7 ; ${name} -= ...`);
            if (op === '*=') asm.push(`MUL  R${reg}, R${reg}, R7 ; ${name} *= ...`);
            return;
        }

        // 10. Simple assignment: x = expr;
        const assignMatch = stmt.match(/^([a-zA-Z_]\w*)\s*=\s*(.+);?$/);
        if (assignMatch) {
            const name = assignMatch[1];
            const expr = assignMatch[2].replace(/;$/, '').trim();
            const reg = varMap[name];
            if (reg === undefined) throw new Error(`Undeclared identifier '${name}'`);
            compileExpression(expr, reg, name);
            return;
        }
    }

    function compileExpression(expr, destReg, debugName) {
        expr = expr.trim();

        // Check for array lookup: arr[i] or arr[0]
        const arrLook = expr.match(/^([a-zA-Z_]\w*)\s*\[\s*(.+?)\s*\]$/);
        if (arrLook) {
            const arrName = arrLook[1];
            const idxExpr = arrLook[2];
            const arrInfo = arrayMap[arrName];
            if (!arrInfo) throw new Error(`Undeclared array '${arrName}'`);

            if (/^\d+$/.test(idxExpr)) {
                const constAddr = arrInfo.baseAddr + parseInt(idxExpr);
                asm.push(`LD   R${destReg}, [R0 + ${constAddr}] ; ${debugName} = ${arrName}[${idxExpr}]`);
            } else if (varMap[idxExpr] !== undefined) {
                const idxReg = varMap[idxExpr];
                asm.push(`ADDI R7, R${idxReg}, ${arrInfo.baseAddr}`);
                asm.push(`LD   R${destReg}, [R7 + 0] ; ${debugName} = ${arrName}[${idxExpr}]`);
            }
            return;
        }

        // Pure constant integer
        if (/^-?\d+$/.test(expr)) {
            asm.push(`ADDI R${destReg}, R0, ${expr} ; ${debugName} = ${expr}`);
            return;
        }

        // Pure variable identifier
        if (varMap[expr] !== undefined) {
            const srcReg = varMap[expr];
            asm.push(`ADD  R${destReg}, R${srcReg}, R0 ; ${debugName} = ${expr}`);
            return;
        }

        // Binary operation: A + B, A - B, A * B, A / B
        const binMatch = expr.match(/^(.+?)\s*([\+\-\*\/])\s*(.+)$/);
        if (binMatch) {
            const left = binMatch[1].trim();
            const op = binMatch[2];
            const right = binMatch[3].trim();

            // Right operand is constant immediate and op is +
            if (op === '+' && /^-?\d+$/.test(right) && varMap[left] !== undefined) {
                asm.push(`ADDI R${destReg}, R${varMap[left]}, ${right} ; ${debugName} = ${left} + ${right}`);
                return;
            }

            // Left operand into destReg, right into R7
            compileExpression(left, destReg, 'left');
            compileExpression(right, 7, 'right');

            if (op === '+') asm.push(`ADD  R${destReg}, R${destReg}, R7 ; ${debugName} = ${left} + ${right}`);
            if (op === '-') asm.push(`SUB  R${destReg}, R${destReg}, R7 ; ${debugName} = ${left} - ${right}`);
            if (op === '*') asm.push(`MUL  R${destReg}, R${destReg}, R7 ; ${debugName} = ${left} * ${right}`);
            if (op === '/') asm.push(`DIV  R${destReg}, R${destReg}, R7 ; ${debugName} = ${left} / ${right}`);
            return;
        }

        throw new Error(`Unsupported expression syntax: '${expr}'`);
    }

    function compileConditionBranch(cond, targetLabel) {
        cond = cond.trim();
        // Supports: a < b, a <= b, a > b, a >= b, a == b, a != b
        const m = cond.match(/^(.+?)\s*(==|!=|<=|>=|<|>)\s*(.+)$/);
        if (!m) throw new Error(`Unsupported conditional expression: '${cond}'`);

        const left = m[1].trim();
        const op = m[2];
        const right = m[3].trim();

        // Evaluate left into R6, right into R7
        compileExpression(left, 6, 'cond_left');
        compileExpression(right, 7, 'cond_right');

        // Branch condition inversion for skipping loop/if body
        // If we want to branch to targetLabel when condition FAILS:
        switch (op) {
            case '<':
                // Fail if left >= right
                asm.push(`BGE  R6, R7, ${targetLabel} ; branch if not (${cond})`);
                break;
            case '<=':
                // Fail if left > right (i.e. right < left)
                asm.push(`BLT  R7, R6, ${targetLabel} ; branch if not (${cond})`);
                break;
            case '>':
                // Fail if left <= right
                asm.push(`BGE  R7, R6, ${targetLabel} ; branch if not (${cond})`);
                break;
            case '>=':
                // Fail if left < right
                asm.push(`BLT  R6, R7, ${targetLabel} ; branch if not (${cond})`);
                break;
            case '==':
                // Fail if left != right
                asm.push(`BNE  R6, R7, ${targetLabel} ; branch if not (${cond})`);
                break;
            case '!=':
                // Fail if left == right
                asm.push(`BEQ  R6, R7, ${targetLabel} ; branch if not (${cond})`);
                break;
        }
    }
}
