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

// Test configuration for NEAR testnet - using deployed contracts
const config = {
  network: "testnet",
  nodeUrl: "https://rpc.testnet.near.org",
  walletUrl: "https://wallet.testnet.near.org",
  accounts: {
    // Using deployed contract addresses
    factory:
      process.env.FACTORY_ACCOUNT || "1prime-global-factory-contract.testnet",
    resolver:
      process.env.RESOLVER_ACCOUNT || "1prime-global-resolver-contract.testnet",
    escrowSrcTemplate:
      process.env.ESCROW_SRC_TEMPLATE ||
      "1prime-global-escrow-src-template.testnet",
    escrowDstTemplate:
      process.env.ESCROW_DST_TEMPLATE ||
      "1prime-global-escrow-dst-template.testnet",
    owner: process.env.OWNER || "1prime-global-owner.testnet",
    // Test accounts for making transactions
    maker: process.env.MAKER_ACCOUNT || "maker-test.testnet",
    taker: process.env.TAKER_ACCOUNT || "taker-test.testnet",
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

    return nearCheck.success && hasCredentials;
  }

  async checkDeployedContracts() {
    this.logSection("📦 Checking Deployed Contracts");

    const contractAccounts = [
      { name: "Factory", account: config.accounts.factory },
      { name: "Resolver", account: config.accounts.resolver },
      {
        name: "Escrow Src Template",
        account: config.accounts.escrowSrcTemplate,
      },
      {
        name: "Escrow Dst Template",
        account: config.accounts.escrowDstTemplate,
      },
    ];

    for (const contract of contractAccounts) {
      // Check if contract is deployed by checking code_hash
      const stateResult = await this.runCommand(
        `near state ${contract.account} --networkId ${config.network}`,
        `Checking ${contract.name} contract`
      );

      if (stateResult.success) {
        const codeHash = stateResult.output.match(/code_hash: '([^']+)'/)?.[1];
        const isDeployed =
          codeHash && codeHash !== "11111111111111111111111111111111";

        this.logTest(
          `${contract.name} Deployment`,
          isDeployed ? "PASS" : "FAIL",
          isDeployed ? "Contract deployed" : "No contract deployed"
        );
      } else {
        this.logTest(
          `${contract.name} Deployment`,
          "FAIL",
          "Account not found or inaccessible"
        );
      }
    }
  }

  async checkTestAccounts() {
    this.logSection("👥 Checking Test Accounts");

    // Only check test accounts (maker/taker), not deployed contract accounts
    const testAccounts = {
      maker: config.accounts.maker,
      taker: config.accounts.taker,
    };

    for (const [name, accountId] of Object.entries(testAccounts)) {
      // Check if account exists on testnet
      const viewResult = await this.runCommand(
        `near view-account ${accountId} --networkId ${config.network}`,
        `Checking ${name} account`
      );

      if (viewResult.success) {
        this.logTest(
          `Test Account: ${accountId}`,
          "PASS",
          "Account exists and accessible"
        );
      } else {
        this.logTest(
          `Test Account: ${accountId}`,
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

  async testFactoryFunctionality() {
    this.logSection("🧪 Testing Factory Functionality");

    // Test factory stats view
    const statsResult = await this.runCommand(
      `near view ${config.accounts.factory} get_stats '{}' --networkId ${config.network}`,
      "Checking factory stats"
    );
    this.logTest(
      "Factory Stats View",
      statsResult.success ? "PASS" : "FAIL",
      statsResult.success ? "Stats retrieved successfully" : statsResult.error
    );

    // Test creating destination escrow via resolver
    const currentTime = Date.now();
    const testOrderHash = `test_order_${Date.now()}`;
    const immutables = {
      order_hash: testOrderHash,
      hashlock:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      maker: config.accounts.maker,
      taker: config.accounts.resolver,
      token: "near",
      amount: "1000000000000000000000000", // 1 NEAR
      safety_deposit: "100000000000000000000000", // 0.1 NEAR
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
    };

    const createDstResult = await this.runCommand(
      `near call ${config.accounts.resolver} deploy_dst '${JSON.stringify({
        dst_immutables: immutables,
        src_cancellation_timestamp: Math.floor(Date.now() / 1000) + 3600,
      })}' --accountId ${
        config.accounts.resolver
      } --gas 300000000000000 --amount 1.1 --networkId ${config.network}`,
      "Creating destination escrow via resolver"
    );
    this.logTest(
      "Create Destination Escrow",
      createDstResult.success ? "PASS" : "FAIL",
      createDstResult.success
        ? "Escrow created successfully"
        : createDstResult.error
    );

    // Test getting escrow address
    if (createDstResult.success) {
      const getAddressResult = await this.runCommand(
        `near view ${config.accounts.factory} get_escrow_address '{"order_hash": "${testOrderHash}"}' --networkId ${config.network}`,
        "Getting escrow address"
      );
      this.logTest(
        "Get Escrow Address",
        getAddressResult.success ? "PASS" : "FAIL",
        getAddressResult.success
          ? "Address retrieved successfully"
          : getAddressResult.error
      );
    }
  }

  async testViewMethods() {
    this.logSection("👁️  Testing View Methods");

    // Test various view methods
    const viewTests = [
      {
        method: "get_stats",
        args: "{}",
        contract: config.accounts.factory,
        name: "Factory Stats",
      },
      {
        method: "get_owner",
        args: "{}",
        contract: config.accounts.factory,
        name: "Factory Owner",
      },
      {
        method: "get_owner",
        args: "{}",
        contract: config.accounts.resolver,
        name: "Resolver Owner",
      },
    ];

    for (const test of viewTests) {
      const result = await this.runCommand(
        `near view ${test.contract} ${test.method} '${test.args}' --networkId ${config.network}`,
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

      await this.checkDeployedContracts();
      await this.checkTestAccounts();
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
