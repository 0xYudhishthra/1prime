const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// ANSI color codes for console output
const colors = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  purple: "\x1b[35m",
  cyan: "\x1b[36m",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
};

// Test configuration for NEAR testnet
const config = {
  network: "testnet",
  nodeUrl: "https://rpc.testnet.near.org",
  walletUrl: "https://wallet.testnet.near.org",
  accounts: {
    // These will be created dynamically or use existing testnet accounts
    factory: process.env.FACTORY_ACCOUNT || "escrow-factory.testnet",
    resolver: process.env.RESOLVER_ACCOUNT || "escrow-resolver.testnet",
    maker: process.env.MAKER_ACCOUNT || "maker-test.testnet",
    taker: process.env.TAKER_ACCOUNT || "taker-test.testnet",
  },
  contracts: {
    factory: "../escrow-factory/target/near/escrow_factory.wasm",
    escrowDst: "../escrow-dst/target/near/escrow_dst.wasm",
    escrowSrc: "../escrow-src/target/near/escrow_src.wasm",
    resolver: "../resolver/target/near/near_resolver.wasm",
  },
};

class TestRunner {
  constructor() {
    this.testResults = [];
    this.startTime = Date.now();
  }

  log(message, color = "reset") {
    console.log(`${colors[color]}${message}${colors.reset}`);
  }

  logSection(title) {
    this.log(`\n${colors.bold}${colors.blue}${title}${colors.reset}`);
    this.log("═".repeat(title.length), "blue");
  }

  logTest(testName, status, details = "") {
    const icon = status === "PASS" ? "✅" : status === "FAIL" ? "❌" : "⚠️";
    const color =
      status === "PASS" ? "green" : status === "FAIL" ? "red" : "yellow";
    this.log(`${icon} ${testName}`, color);
    if (details) {
      this.log(`   ${details}`, "cyan");
    }
    this.testResults.push({ testName, status, details });
  }

  async runCommand(command, description = "") {
    try {
      if (description) {
        this.log(`🔄 ${description}...`, "yellow");
      }

      const output = execSync(command, {
        stdio: "pipe",
        encoding: "utf8",
        env: {
          ...process.env,
          NEAR_CLI_LOCALNET_NETWORK_ID: config.network,
          NEAR_NODE_URL: config.nodeUrl,
          NEAR_WALLET_URL: config.walletUrl,
        },
      });

      return { success: true, output: output.trim() };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        output: error.stdout ? error.stdout.toString() : "",
      };
    }
  }

  async checkPrerequisites() {
    this.logSection("🔍 Checking Prerequisites");

    // Check NEAR testnet connectivity
    try {
      const response = await fetch("https://rpc.testnet.near.org/status");
      if (response.ok) {
        this.logTest("NEAR Testnet Status", "PASS", "Connected to testnet RPC");
      } else {
        this.logTest("NEAR Testnet Status", "FAIL", "RPC not responding");
        return false;
      }
    } catch (error) {
      this.logTest(
        "NEAR Testnet Status",
        "FAIL",
        "Cannot connect to testnet RPC"
      );
      return false;
    }

    // Check NEAR CLI
    const nearCheck = await this.runCommand("which near");
    this.logTest(
      "NEAR CLI",
      nearCheck.success ? "PASS" : "FAIL",
      nearCheck.success
        ? "Installed"
        : "Not found - install with: npm install -g near-cli"
    );

    // Check if contracts are built
    const contractsExist = Object.values(config.contracts).every(contract =>
      fs.existsSync(path.join(__dirname, contract))
    );
    this.logTest(
      "Contract Builds",
      contractsExist ? "PASS" : "FAIL",
      contractsExist
        ? "All WASM files present"
        : "Missing WASM files - run: ./build.sh"
    );

    // Check for testnet account credentials
    const homeDir = require("os").homedir();
    const nearCredentialsDir = path.join(
      homeDir,
      ".near-credentials",
      "testnet"
    );
    const hasCredentials = fs.existsSync(nearCredentialsDir);
    this.logTest(
      "Testnet Credentials",
      hasCredentials ? "PASS" : "FAIL",
      hasCredentials
        ? "Found testnet keys"
        : "No testnet accounts - create at https://wallet.testnet.near.org"
    );

    return nearCheck.success && contractsExist && hasCredentials;
  }

  async buildContracts() {
    this.logSection("🔨 Building Contracts");

    const buildResult = await this.runCommand(
      "./build.sh",
      "Building all contracts"
    );
    this.logTest(
      "Contract Build",
      buildResult.success ? "PASS" : "FAIL",
      buildResult.success
        ? "All contracts built successfully"
        : buildResult.error
    );

    // Verify individual contract builds
    for (const [name, path] of Object.entries(config.contracts)) {
      const exists = fs.existsSync(path);
      this.logTest(
        `${name} WASM`,
        exists ? "PASS" : "FAIL",
        exists ? `Found at ${path}` : `Missing: ${path}`
      );
    }

    return buildResult.success;
  }

  async createTestAccounts() {
    this.logSection("👥 Checking Test Accounts");

    for (const [name, accountId] of Object.entries(config.accounts)) {
      // Check if account exists on testnet
      const viewResult = await this.runCommand(
        `near view-account ${accountId} --nodeUrl ${config.nodeUrl} --networkId ${config.network}`,
        `Checking ${name} account`
      );

      if (viewResult.success) {
        this.logTest(
          `Account: ${accountId}`,
          "PASS",
          "Account exists and accessible"
        );
      } else {
        this.logTest(
          `Account: ${accountId}`,
          "FAIL",
          "Account not found - please create at https://wallet.testnet.near.org"
        );
        this.log(`   💡 To create ${accountId}:`, "yellow");
        this.log(`      1. Visit https://wallet.testnet.near.org`, "yellow");
        this.log(`      2. Create account: ${accountId}`, "yellow");
        this.log(`      3. Fund it with testnet NEAR tokens`, "yellow");
      }
    }

    this.log("\n💰 Get testnet NEAR tokens at:", "blue");
    this.log("   https://near-faucet.io/", "yellow");
  }

  async deployContracts() {
    this.logSection("🚀 Deploying Contracts");

    // Deploy Factory
    const factoryDeploy = await this.runCommand(
      `near deploy --wasmFile ${config.contracts.factory} --accountId ${config.accounts.factory} --nodeUrl ${config.nodeUrl} --networkId ${config.network}`,
      "Deploying Factory contract"
    );
    this.logTest(
      "Factory Deployment",
      factoryDeploy.success ? "PASS" : "FAIL",
      factoryDeploy.success ? "Deployed successfully" : factoryDeploy.error
    );

    // Initialize Factory (owner will be the resolver account)
    const factoryInit = await this.runCommand(
      `near call ${config.accounts.factory} new '{"owner": "${config.accounts.resolver}", "rescue_delay": 1800}' --accountId ${config.accounts.factory} --gas 300000000000000 --nodeUrl ${config.nodeUrl} --networkId ${config.network}`,
      "Initializing Factory contract"
    );
    this.logTest(
      "Factory Initialization",
      factoryInit.success ? "PASS" : "FAIL",
      factoryInit.success ? "Initialized successfully" : factoryInit.error
    );

    // Deploy Resolver (if resolver contract exists)
    if (fs.existsSync(path.join(__dirname, config.contracts.resolver))) {
      const resolverDeploy = await this.runCommand(
        `near deploy --wasmFile ${config.contracts.resolver} --accountId ${config.accounts.resolver} --nodeUrl ${config.nodeUrl} --networkId ${config.network}`,
        "Deploying Resolver contract"
      );
      this.logTest(
        "Resolver Deployment",
        resolverDeploy.success ? "PASS" : "FAIL",
        resolverDeploy.success ? "Deployed successfully" : resolverDeploy.error
      );

      const resolverInit = await this.runCommand(
        `near call ${config.accounts.resolver} new '{"escrow_factory": "${config.accounts.factory}", "owner": "${config.accounts.resolver}"}' --accountId ${config.accounts.resolver} --gas 300000000000000 --nodeUrl ${config.nodeUrl} --networkId ${config.network}`,
        "Initializing Resolver contract"
      );
      this.logTest(
        "Resolver Initialization",
        resolverInit.success ? "PASS" : "FAIL",
        resolverInit.success ? "Initialized successfully" : resolverInit.error
      );
    } else {
      this.logTest(
        "Resolver Contract",
        "SKIP",
        "Resolver WASM not found - will deploy factory only"
      );
    }

    return factoryDeploy.success && factoryInit.success;
  }

  async setEscrowCode() {
    this.logSection("📝 Setting Escrow WASM Code");

    // Set destination escrow code
    const dstWasmPath = path.join(__dirname, config.contracts.escrowDst);
    if (fs.existsSync(dstWasmPath)) {
      const base64DstCommand = `base64 -i ${dstWasmPath}`;
      const base64DstResult = await this.runCommand(base64DstCommand);

      if (base64DstResult.success) {
        const setDstCode = await this.runCommand(
          `near call ${config.accounts.factory} set_escrow_dst_code '{"escrow_code": "${base64DstResult.output}"}' --accountId ${config.accounts.resolver} --gas 300000000000000 --nodeUrl ${config.nodeUrl} --networkId ${config.network}`,
          "Setting destination escrow WASM code"
        );
        this.logTest(
          "Set Dst Escrow Code",
          setDstCode.success ? "PASS" : "FAIL",
          setDstCode.success ? "Code uploaded successfully" : setDstCode.error
        );
      } else {
        this.logTest(
          "Set Dst Escrow Code",
          "FAIL",
          "Failed to encode WASM file to base64"
        );
      }
    } else {
      this.logTest(
        "Set Dst Escrow Code",
        "SKIP",
        "Destination escrow WASM not found"
      );
    }

    // Set source escrow code if it exists
    const srcWasmPath = path.join(__dirname, config.contracts.escrowSrc);
    if (fs.existsSync(srcWasmPath)) {
      const base64SrcCommand = `base64 -i ${srcWasmPath}`;
      const base64SrcResult = await this.runCommand(base64SrcCommand);

      if (base64SrcResult.success) {
        const setSrcCode = await this.runCommand(
          `near call ${config.accounts.factory} set_escrow_src_code '{"escrow_code": "${base64SrcResult.output}"}' --accountId ${config.accounts.resolver} --gas 300000000000000 --nodeUrl ${config.nodeUrl} --networkId ${config.network}`,
          "Setting source escrow WASM code"
        );
        this.logTest(
          "Set Src Escrow Code",
          setSrcCode.success ? "PASS" : "FAIL",
          setSrcCode.success ? "Code uploaded successfully" : setSrcCode.error
        );
      } else {
        this.logTest(
          "Set Src Escrow Code",
          "FAIL",
          "Failed to encode WASM file to base64"
        );
      }
    } else {
      this.logTest(
        "Set Src Escrow Code",
        "SKIP",
        "Source escrow WASM not found"
      );
    }
  }

  async testFactoryFunctionality() {
    this.logSection("🧪 Testing Factory Functionality");

    // Test factory stats view
    const statsResult = await this.runCommand(
      `near view ${config.accounts.factory} get_factory_stats --nodeUrl ${config.nodeUrl} --networkId ${config.network}`,
      "Checking factory stats"
    );
    this.logTest(
      "Factory Stats View",
      statsResult.success ? "PASS" : "FAIL",
      statsResult.success ? "Stats retrieved successfully" : statsResult.error
    );

    // Test creating destination escrow
    const currentTime = Date.now();
    const escrowData = {
      order_hash: "test_order_123",
      immutables: {
        order_hash: "test_order_123",
        hashlock:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        maker: config.accounts.maker,
        taker: config.accounts.taker,
        token: "near",
        amount: "1000000000000000000000000",
        safety_deposit: "100000000000000000000000",
        timelocks: {
          deployed_at: currentTime,
          src_withdrawal: 300,
          src_public_withdrawal: 600,
          src_cancellation: 900,
          src_public_cancellation: 1200,
          dst_withdrawal: 180,
          dst_public_withdrawal: 360,
          dst_cancellation: 720,
        },
      },
      dst_complement: {
        safety_deposit: "100000000000000000000000",
        deployed_at: currentTime,
      },
    };

    const createEscrowResult = await this.runCommand(
      `near call ${config.accounts.factory} create_dst_escrow '${JSON.stringify(
        escrowData
      )}' --accountId ${
        config.accounts.taker
      } --gas 300000000000000 --amount 1.1 --nodeUrl ${
        config.nodeUrl
      } --networkId ${config.network}`,
      "Creating destination escrow"
    );
    this.logTest(
      "Create Destination Escrow",
      createEscrowResult.success ? "PASS" : "FAIL",
      createEscrowResult.success
        ? "Escrow created successfully"
        : createEscrowResult.error
    );
  }

  async testViewMethods() {
    this.logSection("👁️  Testing View Methods");

    // Test various view methods
    const viewTests = [
      {
        method: "get_factory_stats",
        contract: config.accounts.factory,
        name: "Factory Stats",
      },
      {
        method: "get_owner",
        contract: config.accounts.factory,
        name: "Factory Owner",
      },
    ];

    if (fs.existsSync(config.contracts.resolver)) {
      viewTests.push(
        {
          method: "get_factory",
          contract: config.accounts.resolver,
          name: "Resolver Factory",
        },
        {
          method: "get_owner",
          contract: config.accounts.resolver,
          name: "Resolver Owner",
        }
      );
    }

    for (const test of viewTests) {
      const result = await this.runCommand(
        `near view ${test.contract} ${test.method} --nodeUrl ${config.nodeUrl} --networkId ${config.network}`,
        `Testing ${test.name} view`
      );
      this.logTest(
        `View: ${test.name}`,
        result.success ? "PASS" : "FAIL",
        result.success ? "Method executed successfully" : result.error
      );
    }
  }

  async runExampleScripts() {
    this.logSection("📄 Testing Example Scripts");

    const exampleDir = path.join(__dirname, "examples");
    const examples = ["near-to-eth-swap.js", "eth-to-near-swap.js"];

    for (const example of examples) {
      const examplePath = path.join(exampleDir, example);
      if (fs.existsSync(examplePath)) {
        this.logTest(
          `Example: ${example}`,
          "PASS",
          "Available and ready to run"
        );
      } else {
        this.logTest(`Example: ${example}`, "FAIL", "File not found");
      }
    }

    this.log("\n💡 To run examples after tests complete:", "blue");
    this.log("   cd tests/examples", "yellow");
    this.log("   node near-to-eth-swap.js", "yellow");
    this.log("   node eth-to-near-swap.js", "yellow");
  }

  generateReport() {
    this.logSection("📊 Test Report");

    const passCount = this.testResults.filter(r => r.status === "PASS").length;
    const failCount = this.testResults.filter(r => r.status === "FAIL").length;
    const skipCount = this.testResults.filter(r => r.status === "SKIP").length;
    const totalTime = ((Date.now() - this.startTime) / 1000).toFixed(2);

    this.log(`\n${colors.bold}Summary:${colors.reset}`);
    this.log(`✅ Passed: ${passCount}`, "green");
    this.log(`❌ Failed: ${failCount}`, failCount > 0 ? "red" : "reset");
    this.log(`⚠️  Skipped: ${skipCount}`, "yellow");
    this.log(`⏱️  Total time: ${totalTime}s`, "cyan");

    if (failCount > 0) {
      this.log(`\n${colors.bold}Failed Tests:${colors.reset}`);
      this.testResults
        .filter(r => r.status === "FAIL")
        .forEach(test => {
          this.log(`  • ${test.testName}: ${test.details}`, "red");
        });
    }

    this.log(`\n${colors.bold}Useful Resources:${colors.reset}`);
    this.log(`  • Testnet Explorer: https://explorer.testnet.near.org`, "cyan");
    this.log(`  • Testnet Wallet: https://wallet.testnet.near.org`, "cyan");
    this.log(`  • RPC Endpoint: https://rpc.testnet.near.org`, "cyan");
    this.log(`  • Testnet Faucet: https://near-faucet.io/`, "cyan");

    return failCount === 0;
  }

  async run() {
    this.log(
      `${colors.bold}${colors.blue}🧪 NEAR Cross-Chain Escrow Integration Tests${colors.reset}`
    );
    this.log(`${colors.blue}${"═".repeat(50)}${colors.reset}\n`);

    try {
      // Run test phases
      const prereqsOk = await this.checkPrerequisites();
      if (!prereqsOk) {
        this.log(`${colors.red}Prerequisites not met. Exiting.${colors.reset}`);
        return false;
      }

      // Change to contract directory
      process.chdir(path.join(__dirname, ".."));

      await this.buildContracts();
      await this.createTestAccounts();
      await this.deployContracts();
      await this.setEscrowCode();
      await this.testFactoryFunctionality();
      await this.testViewMethods();
      await this.runExampleScripts();

      const success = this.generateReport();

      if (success) {
        this.log(
          `\n${colors.green}🎉 All tests completed successfully!${colors.reset}`
        );
      } else {
        this.log(
          `\n${colors.red}❌ Some tests failed. Please check the report above.${colors.reset}`
        );
      }

      return success;
    } catch (error) {
      this.log(
        `\n${colors.red}💥 Test runner encountered an error: ${error.message}${colors.reset}`
      );
      return false;
    }
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  const runner = new TestRunner();
  runner.run().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = TestRunner;
