---
name: Python global in nested block
description: SyntaxError when declaring global inside with/if/for block — must be at function top
---

## Rule
`global varname` MUST be declared at the **top of the function body**, never inside a nested block (`with`, `if`, `for`, `try`, etc.).

**Why:** Python raises `SyntaxError: name 'x' is used prior to global declaration` if the variable appears in any expression before the global statement — and indentation inside a block counts as "after" the outer scope uses.

**How to apply:** Any time you write `global foo` inside a function, move it to the very first lines of the function, before any reads or writes of that variable. This applies even when the variable is only written (not read) inside the block.

```python
# WRONG — inside with block
def fetch():
    with lock:
        global _weight
        _weight = 5  # SyntaxError

# CORRECT — at top of function
def fetch():
    global _weight  # declare here
    ...
    with lock:
        _weight = 5  # now OK
```
