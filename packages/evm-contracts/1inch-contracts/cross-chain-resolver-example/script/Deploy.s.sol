// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Script, console2} from 'forge-std/Script.sol';
import {TestEscrowFactory} from '../contracts/src/TestEscrowFactory.sol';
import {Resolver} from '../contracts/src/Resolver.sol';
import {IERC20} from 'openzeppelin-contracts/contracts/token/ERC20/IERC20.sol';
import {IEscrowFactory} from 'cross-chain-swap/interfaces/IEscrowFactory.sol';
import {IOrderMixin} from '@1inch/limit-order-protocol-contract/contracts/interfaces/IOrderMixin.sol';

contract Deploy is Script {
    // Known LOP addresses by chain ID
    mapping(uint256 => address) public lopAddresses;
    mapping(uint256 => address) public wethAddresses;

    // Deploy parameters
    uint32 constant RESCUE_DELAY_SRC = 1800; // 30 minutes
    uint32 constant RESCUE_DELAY_DST = 1800; // 30 minutes

    function setUp() public {
        // Ethereum Mainnet (Chain ID: 1)
        lopAddresses[1] = 0x111111125421cA6dc452d289314280a0f8842A65;
        wethAddresses[1] = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

        // Sepolia Testnet (Chain ID: 11155111)
        lopAddresses[11155111] = 0x111111125421cA6dc452d289314280a0f8842A65;
        wethAddresses[11155111] = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;

        // BSC Mainnet (Chain ID: 56)
        lopAddresses[56] = 0x1e38Eff998DF9d3669E32f4ff400031385Bf6362;
        wethAddresses[56] = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;

        // Polygon Mainnet (Chain ID: 137)
        lopAddresses[137] = 0x94Bc2a1C732BcAd7343B25af48385Fe76E08734f;
        wethAddresses[137] = 0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270;

        // Add more chains as needed
    }

    function run() public {
        uint256 chainId = block.chainid;
        uint256 deployerPrivateKey = vm.envUint('PRIVATE_KEY');
        address deployer = vm.addr(deployerPrivateKey);

        address lopAddress = lopAddresses[chainId];
        address wethAddress = wethAddresses[chainId];

        require(lopAddress != address(0), 'LOP address not configured for this chain');
        require(wethAddress != address(0), 'WETH address not configured for this chain');

        string memory chainName = getChainName(chainId);

        console2.log('=================================================');
        console2.log('Deploying to', chainName);
        console2.log('=================================================');
        console2.log('Chain ID:', chainId);
        console2.log('Deployer address:', deployer);
        console2.log('Deployer balance:', deployer.balance / 1e18, 'ETH');
        console2.log('LOP address:', lopAddress);
        console2.log('WETH address:', wethAddress);
        console2.log('');

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy TestEscrowFactory
        console2.log('1. Deploying TestEscrowFactory...');
        TestEscrowFactory escrowFactory = new TestEscrowFactory(
            lopAddress, // limitOrderProtocol
            IERC20(wethAddress), // feeToken (WETH)
            IERC20(address(0)), // accessToken (zero address)
            deployer, // owner
            RESCUE_DELAY_SRC, // src rescue delay
            RESCUE_DELAY_DST // dst rescue delay
        );
        console2.log('TestEscrowFactory deployed to:', address(escrowFactory));

        // 2. Deploy Resolver
        console2.log('');
        console2.log('2. Deploying Resolver...');
        Resolver resolver = new Resolver(
            IEscrowFactory(address(escrowFactory)), // escrowFactory
            IOrderMixin(lopAddress), // limitOrderProtocol
            deployer // owner
        );
        console2.log('Resolver deployed to:', address(resolver));

        vm.stopBroadcast();

        // 3. Summary
        console2.log('');
        console2.log('=================================================');
        console2.log('DEPLOYMENT SUMMARY');
        console2.log('=================================================');
        console2.log('Network:', chainName);
        console2.log('Chain ID:', chainId);
        console2.log('Deployer:', deployer);
        console2.log('');
        console2.log('Contract Addresses:');
        console2.log('LimitOrderProtocol (existing):', lopAddress);
        console2.log('TestEscrowFactory (deployed):', address(escrowFactory));
        console2.log('Resolver (deployed):', address(resolver));
        console2.log('');
        console2.log('Next Steps:');
        console2.log('- Verify contracts on block explorer');
        console2.log('- Update your application config with these addresses');
        console2.log('- Test the deployment with a cross-chain swap');
    }

    function getChainName(uint256 chainId) internal pure returns (string memory) {
        if (chainId == 1) return 'Ethereum Mainnet';
        if (chainId == 11155111) return 'Sepolia Testnet';
        if (chainId == 56) return 'BSC Mainnet';
        if (chainId == 137) return 'Polygon Mainnet';
        if (chainId == 10) return 'Optimism Mainnet';
        if (chainId == 42161) return 'Arbitrum One';
        if (chainId == 43114) return 'Avalanche Mainnet';
        if (chainId == 250) return 'Fantom Opera';
        if (chainId == 100) return 'Gnosis Chain';
        return 'Unknown Network';
    }
}
