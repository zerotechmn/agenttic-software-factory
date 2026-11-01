# Bundled skills

The skills FORGE's roles load (`skills:` in `roles/*.md`, plus the PixiJS extras in `src/skills.ts`), copied here so
every machine runs the same agents. Each role only sees its own skills: they are copied into the agent's working
directory at start (`installSkills`). To add folders of your own, set `FORGE_SKILL_ROOTS=/path/a:/path/b`.

Each folder keeps its upstream `LICENSE`.

| Skills | Source | License |
|---|---|---|
| api-design, backend-patterns, coding-standards, design-system, docker-patterns, documentation-lookup, e2e-testing, frontend-design-direction, frontend-patterns, production-audit, react-patterns, security-review | [affaan-m/ECC](https://github.com/affaan-m/ECC) 2.2.3 | MIT |
| brainstorming, systematic-debugging, verification-before-completion, writing-plans | [obra/superpowers](https://github.com/obra/superpowers) 7.0.0 | MIT |
| diagnosing-bugs, grilling, research, tdd | [mattpocock/skills](https://github.com/mattpocock/skills) | MIT |
| frontend-design | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | Apache-2.0 |
| playwright-cli | [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli) | Apache-2.0 |
| ui-ux-pro-max | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) (its search scripts need Python 3; optional) | MIT |
| pixijs | [pixijs/pixijs-skills](https://github.com/pixijs/pixijs-skills) | MIT |
| game-ai, game-feel | see each folder's LICENSE | Apache-2.0 |
| pixi-v8-pixel-games | written for FORGE | same as this repo |
