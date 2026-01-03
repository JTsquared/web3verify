const { ethers } = require('ethers');

// Standard ERC20 ABI (just the balanceOf function)
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)'
];

// Standard ERC721 ABI (NFT)
const ERC721_ABI = [
  'function balanceOf(address owner) view returns (uint256)'
];

// Standard ERC1155 ABI (Multi-token)
const ERC1155_ABI = [
  'function balanceOf(address account, uint256 id) view returns (uint256)'
];

// Common staking contract ABI
const STAKING_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function stakedBalanceOf(address account) view returns (uint256)'
];

class BlockchainService {
  constructor(rpcUrl) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
  }

  /**
   * Check ERC20 token balance
   */
  async checkERC20Balance(walletAddress, contractAddress, minBalance) {
    try {
      const contract = new ethers.Contract(contractAddress, ERC20_ABI, this.provider);
      const balance = await contract.balanceOf(walletAddress);
      const decimals = await contract.decimals();

      const formattedBalance = ethers.formatUnits(balance, decimals);
      const minBalanceFormatted = ethers.parseUnits(minBalance.toString(), decimals);

      return {
        hasBalance: balance >= minBalanceFormatted,
        balance: formattedBalance,
        required: minBalance
      };
    } catch (error) {
      console.error(`Error checking ERC20 balance: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check ERC721 NFT balance
   */
  async checkERC721Balance(walletAddress, contractAddress, minBalance = '1') {
    try {
      const contract = new ethers.Contract(contractAddress, ERC721_ABI, this.provider);
      const balance = await contract.balanceOf(walletAddress);

      const minBalanceBN = BigInt(minBalance);

      return {
        hasBalance: balance >= minBalanceBN,
        balance: balance.toString(),
        required: minBalance
      };
    } catch (error) {
      console.error(`Error checking ERC721 balance: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check ERC1155 token balance
   * Note: Requires tokenId
   */
  async checkERC1155Balance(walletAddress, contractAddress, tokenId, minBalance = '1') {
    try {
      const contract = new ethers.Contract(contractAddress, ERC1155_ABI, this.provider);
      const balance = await contract.balanceOf(walletAddress, tokenId);

      const minBalanceBN = BigInt(minBalance);

      return {
        hasBalance: balance >= minBalanceBN,
        balance: balance.toString(),
        required: minBalance
      };
    } catch (error) {
      console.error(`Error checking ERC1155 balance: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check staked token balance (raw balance only)
   */
  async getStakedBalance(walletAddress, stakingContractAddress) {
    try {
      const contract = new ethers.Contract(stakingContractAddress, STAKING_ABI, this.provider);

      // Try stakedBalanceOf first, fall back to balanceOf
      let balance;
      try {
        balance = await contract.stakedBalanceOf(walletAddress);
      } catch {
        balance = await contract.balanceOf(walletAddress);
      }

      return balance;
    } catch (error) {
      console.error(`Error checking staked balance: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check ERC20 balance including staked tokens
   * Adds wallet balance + staked balance together
   */
  async checkERC20BalanceWithStaking(walletAddress, contractAddress, stakingContractAddress, minBalance) {
    try {
      const contract = new ethers.Contract(contractAddress, ERC20_ABI, this.provider);

      // Get wallet balance
      const walletBalance = await contract.balanceOf(walletAddress);

      // Get staked balance
      const stakedBalance = await this.getStakedBalance(walletAddress, stakingContractAddress);

      // Add them together
      const totalBalance = walletBalance + stakedBalance;

      const decimals = await contract.decimals();
      const formattedBalance = ethers.formatUnits(totalBalance, decimals);
      const formattedWalletBalance = ethers.formatUnits(walletBalance, decimals);
      const formattedStakedBalance = ethers.formatUnits(stakedBalance, decimals);
      const minBalanceFormatted = ethers.parseUnits(minBalance.toString(), decimals);

      console.log(`Wallet balance: ${formattedWalletBalance}, Staked balance: ${formattedStakedBalance}, Total: ${formattedBalance}, Required: ${minBalance}`);

      return {
        hasBalance: totalBalance >= minBalanceFormatted,
        balance: formattedBalance,
        required: minBalance
      };
    } catch (error) {
      console.error(`Error checking ERC20 balance with staking: ${error.message}`);
      throw error;
    }
  }

  /**
   * Verify a wallet address owns required tokens based on role config
   */
  async verifyTokenRequirements(walletAddress, roleConfig) {
    try {
      // Check based on token type
      switch (roleConfig.token_type) {
        case 'ERC20':
          // If there's a staking contract, check both wallet AND staking balance
          if (roleConfig.staking_contract) {
            return await this.checkERC20BalanceWithStaking(
              walletAddress,
              roleConfig.contract_address,
              roleConfig.staking_contract,
              roleConfig.min_balance
            );
          } else {
            // No staking, just check wallet
            return await this.checkERC20Balance(
              walletAddress,
              roleConfig.contract_address,
              roleConfig.min_balance
            );
          }

        case 'ERC721':
          return await this.checkERC721Balance(
            walletAddress,
            roleConfig.contract_address,
            roleConfig.min_balance
          );

        case 'ERC1155':
          // For ERC1155, min_balance format should be "tokenId:amount"
          const [tokenId, amount] = roleConfig.min_balance.split(':');
          return await this.checkERC1155Balance(
            walletAddress,
            roleConfig.contract_address,
            tokenId,
            amount || '1'
          );

        default:
          throw new Error(`Unsupported token type: ${roleConfig.token_type}`);
      }
    } catch (error) {
      console.error(`Error verifying token requirements: ${error.message}`);
      throw error;
    }
  }

  /**
   * Verify a message signature to prove wallet ownership
   */
  verifySignature(message, signature, expectedAddress) {
    try {
      const recoveredAddress = ethers.verifyMessage(message, signature);
      return recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();
    } catch (error) {
      console.error(`Error verifying signature: ${error.message}`);
      return false;
    }
  }
}

module.exports = BlockchainService;
