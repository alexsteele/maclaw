# AGENTS

## Repository Instructions

- Do not modify sections of files commented with `HUMAN` without asking the user first.
- Confirm large architectural changes and new interfaces with the user.
- Confirm new package dependencies with the user. Avoid adding unnecessary dependencies.
- Do not worry about backwards compatibility unless instructed by the user.

## Code Style

- Format files and avoid trailing whitespace.
- Add a header comment to important files, functions, and classes briefly
  explaining what it does. Link to any relevant documentation.
- Put key lifecycle methods towards the top of classes.
- Use simple clear names focused on our domain concepts.
- Put important commands/fields first in a readable order for users.
- Keep functions focused and ask the user if you're unsure how to organize them.
- Avoid creating very similar types like "RawConfig" and "Config". Keep it simple.
- Reserve exceptions for exceptional events like IO errors, not bad user input.
