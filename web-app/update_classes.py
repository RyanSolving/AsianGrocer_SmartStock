import sys
import re

def process(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    # We need to replace className="stock-input..." with className={getClasses(var, "stock-input...")}
    # where var is left, right, single, or row.

    # This is a bit tricky with pure regex because the variable name depends on the context.
    # But we know exactly what variables are in what blocks.
    # Let's just do it manually by reading line by line and keeping state.
    
    lines = content.split('\n')
    out = []
    
    var_name = "left" # default
    
    for i, line in enumerate(lines):
        if 'const left = ' in line: var_name = "left"
        elif 'const right = ' in line: var_name = "right"
        elif 'single.item' in line: var_name = "single"
        elif 'row.item' in line: var_name = "row"
        elif 'left ? (' in line: var_name = "left"
        elif 'right ? (' in line: var_name = "right"

        if 'className="stock-input"' in line:
            line = line.replace('className="stock-input"', f'className={{getClasses({var_name}, "stock-input")}}')
        elif 'className="stock-qty-input"' in line:
            line = line.replace('className="stock-qty-input"', f'className={{getClasses({var_name}, "stock-qty-input")}}')
        elif 'className="stock-input stock-input-hw"' in line:
            line = line.replace('className="stock-input stock-input-hw"', f'className={{getClasses({var_name}, "stock-input stock-input-hw")}}')
            
        out.append(line)

    with open(filepath, 'w') as f:
        f.write('\n'.join(out))

if __name__ == '__main__':
    process('d:/Personal project/Stock Management/AsianGrocer_SmartStock/web-app/app/page.tsx')
