# AGENTS.md

## Repo State
- Hardhat + TypeScript Solidity repo; `README.md` is the default sample and is less accurate than `package.json`/`hardhat.config.ts`.
- Product target is a DeFi term-deposit banking system: users lock ERC20 tokens for a fixed period and withdraw principal plus interest after maturity.
- Current worktree may have many tracked contract/test/deploy files deleted; do not restore or revert them unless explicitly asked.
- Load `blockchain-developer` for contract/deploy work and `solidity-gas-optimization` for Solidity review, audit, or gas-focused changes.

## Contract Expectations
- Prioritize security and gas together: use checks-effects-interactions, custom errors, bounded iteration, cached storage reads, and packed structs where it stays readable.
- Public/external Solidity functions should have NatSpec covering purpose, parameters, return values, and maturity/withdrawal edge cases.
- For deposits/withdrawals, define behavior explicitly for early withdrawals, matured positions, zero amounts, insufficient contract liquidity, fee-on-transfer tokens, and repeated withdrawals.
- Use OpenZeppelin contracts where appropriate; this repo already includes OZ v5.x, Hardhat, Ethers v6, and TypeChain.
- If frontend code is added later, wire contract calls through generated TypeChain types and handle loading, pending txs, user rejection, wrong network, and network switching states.

## Commands
- `npm run compile` runs `hardhat compile`; compile also exports ABIs to `data/abi/`, runs contract sizer, and generates TypeChain in `typechain/`.
- `npm test` runs all Hardhat mocha tests in `test/`; focused tests use `npx hardhat test test/Name.test.ts`.
- `REPORT_GAS=1 npm test` enables `hardhat-gas-reporter` (PowerShell: `$env:REPORT_GAS="1"; npm test`).
- `npm run size` runs contract sizer directly; `npm run clean` removes Hardhat artifacts/cache.
- `npm run node` starts a local Hardhat node.
- `npm run run:sepolia -- scripts/Name.ts` or `npx hardhat run --network sepolia scripts/Name.ts` runs Hardhat scripts.
- `npm run run:ethereum -- scripts/Name.ts` targets mainnet; verify intent before using it.
- `npx hardhat deploy --network <network>` runs `hardhat-deploy` scripts from `deploy/` when present.

## Config Facts
- Solidity compiler is `0.8.28`, `evmVersion: "cancun"`, optimizer enabled with `runs: 1000`, and `viaIR: true`.
- Networks are public RPCs: `sepolia` uses `TESTNET_PRIVATE_KEY`, `ethereum` uses `MAINNET_PRIVATE_KEY`; `.env_example` also defines `ETHERSCAN_API` and `REPORT_GAS`.
- `dotenv.config()` is loaded from `hardhat.config.ts`; `.env` is gitignored.
- `namedAccounts.deployer` is account index `0`; mocha timeout is `40000` ms.
- TypeChain target is `ethers-v6`; import generated contract types from `../typechain` after compiling.
- Only Prettier setting is `printWidth: 120` in `package.json`; there is no lint/typecheck/CI config in this repo.

## Project Layout
- `contracts/`: Solidity sources when present.
- `deploy/`: `hardhat-deploy` scripts; committed examples use numbered filenames and `DeployFunction` with `func.tags = ["deploy"]`.
- `test/`: Hardhat mocha/chai tests; committed examples deploy once in `before()` and use BigInt expectations like `0n`.
- `scripts/`: Hardhat runtime scripts; committed examples use `ethers.getContract("Name")`, so deploy artifacts must exist.
- `etherTest/`: standalone ethers scripts; committed examples use `import "dotenv/config"`, manual ABI arrays, and hard-coded deployed addresses.
- `data/abi/`, `typechain/`, `artifacts/`, and `cache/` are generated; avoid hand-editing generated outputs.
