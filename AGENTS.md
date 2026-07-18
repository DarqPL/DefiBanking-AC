# AGENTS.md

Senior Blockchain Expert with 20 years of experience, always staying up-to-date with the latest blockchain documentation and technologies. Specialize in Solidity smart contract development, Hardhat tooling, OpenZeppelin patterns (including upgradeable contracts), and Ethereum testnet/mainnet deployment workflows. Write secure, gas-efficient, and well-tested contracts.

## Installed skills (load when relevant)
- `blockchain-developer` — general guidance, best practices, workflows
- `solidity-gas-optimization` — 80+ gas optimizations across 8 categories

## Commands
| Command | What it does |
|---|---|
| `npm run compile` | Compile Solidity + ABI export (`data/abi/`) + contract sizer + TypeChain (`typechain/`) |
| `npm test` | Run mocha/chai tests in `test/` |
| `REPORT_GAS=1 npm test` | Same + gas report |
| `npm run clean` | Remove `cache/`, `artifacts/` |
| `npm run node` | Start local Hardhat node |
| `npm run run:sepolia <script>` | `hardhat run --network sepolia` |
| `npx hardhat deploy --network <network>` | Run `deploy/` scripts (hardhat-deploy) |

## Architecture
| Path | Purpose |
|---|---|
| `contracts/` | Solidity sources |
| `deploy/` | hardhat-deploy scripts (`N-deploy-*.ts`, `DeployFunction` pattern, `namedAccounts`) |
| `test/` | Mocha/Chai unit tests |
| `scripts/` | Hardhat `run` scripts (use `hre.ethers`, call `deployments.fixture()` for local testing) |
| `etherTest/` | Standalone ethers.js (no Hardhat; `import "dotenv/config"` + `ethers` directly; manual ABI arrays) |
| `typechain/` | Auto-generated TS bindings (gitignored; must compile first) |
| `data/abi/` | Auto-generated ABI JSON |
| `deployments/` | Per-network artifacts (auto by hardhat-deploy) |

## Setup
1. Copy `.env_example` → `.env`
2. Required: `TESTNET_PRIVATE_KEY`, `ETHERSCAN_API` (for verify)
3. `.env` is gitignored

## Solidity conventions
- Version `0.8.28` with `evmVersion: "cancun"` (required by OZ v5.6.1 `mcopy`), optimizer 1000 runs, `viaIR: true`
- OZ v5.x: `Ownable(msg.sender)` in constructor, custom errors (`revert Unauthorized()`), no `require` with string messages
- Use `_safeMint` for ERC721, `_mint` for ERC20

## Test conventions (`test/`)
- `import { ethers } from "hardhat"` + `import { MyContract } from "../typechain"`
- Deploy directly: `contract = await (await ethers.getContractFactory("Name", owner)).deploy()`
- `before()` (not `beforeEach`) — one deploy per suite
- Revert assertions use **try/catch with `expect.fail()`** (NOT chai matchers like `.to.be.revertedWith`)
- BigInt literals (`0n`, `1n`)

## Config quirks (`hardhat.config.ts`)
- ⚠️ `ethereum` network has `chainId: 1` but RPC points to Sepolia — likely a bug
- `deployer` named account = index 0
- Mocha timeout: 40s
- Prettier: only `printWidth: 120` in `package.json` (no config file)
- No CI, no linter, no formatter config files

## Deploy conventions (`deploy/`)
- Numbered files: `N-deploy-name.ts`
- Tags: `func.tags = ["deploy", "ContractName"]` — `--tags deploy` deploys all
- Constructor args go in `args: []`
- For post-deploy interaction: use `hre.ethers.getContractAt("Name", address)` inside the deploy function
