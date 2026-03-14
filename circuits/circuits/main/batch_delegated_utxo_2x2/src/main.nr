use bb_proof_verification::{UltraHonkProof, UltraHonkVerificationKey, verify_honk_proof_non_zk};

global B: u32 = 2; // batch size
global W: u32 = 1; // number of wormhole notes per transaction
global N: u32 = 2; // number of input notes per transaction
global C: u32 = 2; // number of output notes per transaction

fn main(
    eip712_domain_lo: pub Field,
    eip712_domain_hi: pub Field,
    chain_id: pub Field, // pub
    timestamps: pub [Field; B], // pub
    shielded_roots: pub [Field; B], // pub
    wormhole_roots: pub [Field; B], // pub
    signer_roots: pub [Field; B], // pub
    message_hash_his: pub [Field; B], // pub
    message_hash_los: pub [Field; B], // pub
    signer_commitments: pub [Field; B], // pub
    signer_nullifiers: pub [Field; B], // pub
    wormhole_nullifiers: pub [[Field; W]; B], // pub
    input_nullifiers: pub [[Field; N]; B], // pub
    output_commitments: pub [[Field; C]; B], // pub
    proofs: [UltraHonkProof; B],
    verification_key: UltraHonkVerificationKey,
    key_hash: Field,
) {
    for i in 0..B {
        let mut public_inputs = [
            eip712_domain_lo,
            eip712_domain_hi,
            chain_id,
            timestamps[i],
            shielded_roots[i],
            wormhole_roots[i],
            signer_roots[i],
            message_hash_his[i],
            message_hash_los[i],
            signer_commitments[i],
            signer_nullifiers[i],
        ];
        let public_inputs: [Field; 16] = public_inputs.concat(wormhole_nullifiers[i]).concat(input_nullifiers[i]).concat(output_commitments[i]);
        verify_honk_proof_non_zk(verification_key, proofs[i], public_inputs, key_hash);
    }
}