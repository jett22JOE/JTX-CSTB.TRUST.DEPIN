/**
 * Donate 0.1 SOL + Mint NFT Receipt — devnet test
 * Run: node tests/donate_and_mint.js
 */
const {Connection,PublicKey,SystemProgram,Transaction,TransactionInstruction,Keypair,LAMPORTS_PER_SOL,sendAndConfirmTransaction} = require('@solana/web3.js');
const fs = require('fs');
const {createHash} = require('crypto');

const sighash = (name) => createHash('sha256').update('global:'+name).digest().slice(0,8);
const encodeBN = (v) => { const b=Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };

const PROGRAM_ID = new PublicKey('JTX5uXTiZ1M3hJkjv5Cp5F8dr3Jc7nhJbQjCFmgEYA7');
const conn = new Connection('https://devnet.helius-rpc.com/?api-key=98ca6456-20a8-4518-8393-1b9ee6c2b7f3','confirmed');
const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.HOME+'/.config/solana/id.json','utf-8'))));

const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from('vault_config')],PROGRAM_ID);
const [donorPda] = PublicKey.findProgramAddressSync([Buffer.from('donor'),wallet.publicKey.toBuffer()],PROGRAM_ID);
const [receiptPda] = PublicKey.findProgramAddressSync([Buffer.from('receipt'),vaultPda.toBuffer(),wallet.publicKey.toBuffer()],PROGRAM_ID);

async function main() {
  console.log('Wallet:', wallet.publicKey.toBase58());
  console.log('Balance:', (await conn.getBalance(wallet.publicKey)) / LAMPORTS_PER_SOL, 'SOL');

  // Step 1: Donate 0.1 SOL (cumulative = 0.11 SOL = ~$14.63 at $133/SOL)
  console.log('\n--- STEP 1: Donate 0.1 SOL ---');
  const donateData = Buffer.concat([
    sighash('donate_sol'),
    encodeBN(BigInt(Math.floor(0.1 * LAMPORTS_PER_SOL))),
    Buffer.from([0]), // None referrer
  ]);

  const donateIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      {pubkey: wallet.publicKey, isSigner: true, isWritable: true},
      {pubkey: donorPda, isSigner: false, isWritable: true},
      {pubkey: vaultPda, isSigner: false, isWritable: true},
      {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
    ],
    data: donateData,
  });

  const donateSig = await sendAndConfirmTransaction(conn, new Transaction().add(donateIx), [wallet]);
  console.log('✅ Donated 0.1 SOL! TX:', donateSig);
  console.log('   Total donated: ~0.11 SOL = ~$14.63 (above $8 threshold)');

  // Step 2: Mint NFT receipt at $133/SOL
  console.log('\n--- STEP 2: Mint NFT Receipt ---');
  const mintData = Buffer.concat([
    sighash('mint_donor_nft'),
    encodeBN(133000000n), // $133 SOL price in 6-decimal USDC
  ]);

  const mintIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      {pubkey: wallet.publicKey, isSigner: true, isWritable: true},
      {pubkey: donorPda, isSigner: false, isWritable: true},
      {pubkey: receiptPda, isSigner: false, isWritable: true},
      {pubkey: vaultPda, isSigner: false, isWritable: false},
      {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
    ],
    data: mintData,
  });

  const mintSig = await sendAndConfirmTransaction(conn, new Transaction().add(mintIx), [wallet]);
  console.log('✅ NFT Receipt minted! TX:', mintSig);

  // Summary
  const receiptInfo = await conn.getAccountInfo(receiptPda);
  console.log('\n--- RESULT ---');
  console.log('Receipt PDA:', receiptPda.toBase58());
  console.log('Receipt exists:', !!receiptInfo);
  console.log('Receipt size:', receiptInfo ? receiptInfo.data.length + ' bytes' : 'N/A');
  console.log('Donation: ~0.11 SOL = ~$14.63');
  console.log('JTX entitled: ~1.83 JTX ($14.63 / $8 per JTX)');
  console.log('\nView program: https://solscan.io/account/' + PROGRAM_ID.toBase58() + '?cluster=devnet');
  console.log('View receipt: https://solscan.io/account/' + receiptPda.toBase58() + '?cluster=devnet');
}

main().catch(e => console.error('❌ Error:', e.message?.slice(0, 300) || e));
