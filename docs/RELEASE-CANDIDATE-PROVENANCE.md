# NuBloxSQL — Unpublished signed driver candidate provenance

**Stage:** release engineering evidence. This workflow does not publish a
package, sign customer terms, grant a licence, or authorise production use.

The [release provenance workflow](../.github/workflows/release-provenance.yml)
checks the exact `@nublox/driver@0.1.0-dev.0` candidate tarball against
the proprietary licence/package preflight, the locked 21-export public API
baseline and its strict TypeScript consumer, a pinned Git revision and a
SHA-256 digest.

On **pull requests**, the workflow tests these conditions and uploads an
unpublished candidate plus an integrity report. It does not request or
claim successful signed provenance from a pull request.

On **`main` only**, GitHub Actions `actions/attest@v4` uses GitHub OIDC
and Sigstore to sign SLSA build provenance for the actual tarball.
The workflow then independently requires `gh attestation verify` to pass
with the pinned repository, **signer workflow**, exact source commit,
`refs/heads/main` and GitHub-hosted runner identity. A failed or missing
attestation fails the release-provenance job. Successful attestation is
shown by a **green workflow run**, not a local JSON flag. The unsigned
candidate integrity report deliberately says
`signedProvenanceVerified:false` because local checksums never prove
a cryptographic signature.

## Evidence and verification

Download the `driver-unpublished-candidate-<run-id>` artifact for the
relevant successful **main branch** run. It contains the tarball,
`release-candidate.json` and `SHA256SUMS`. Keep the immutable Actions
run URL, commit SHA and associated GitHub repository attestation.

On macOS, in the extracted artifact folder, verify the archive and
signed builder identity:

```bash
shasum -a 256 -c SHA256SUMS
gh attestation verify nublox-driver-0.1.0-dev.0.tgz \
  --repo NuBlox/NuBloxSQL \
  --signer-workflow NuBlox/NuBloxSQL/.github/workflows/release-provenance.yml \
  --source-digest <verified-main-commit-sha> \
  --source-ref refs/heads/main \
  --deny-self-hosted-runners
```

Replace the placeholder SHA with the actual 40-character commit recorded
by the workflow. Do not use an untrusted artifact's text as proof of
builder identity: use cryptographic verification through GitHub's CLI.

The tarball is **not published to npm** and is **not a production release**.
It remains `0.1.0-dev.0`. GitHub-generated provenance verifies identity
and integrity of the built candidate but cannot certify the correctness
of SQL operations, licensing, customer deployment profiles or risk
acceptance. An independent security assessment, stable version/deprecation
policy, distribution authorisation, signed customer licence, product
support/security contact and SLA remain separately gated.

The current workflow is not a trusted multi-party/reusable builder with
separated administrative control and does not claim any SLSA maturity
level beyond the observed provenance statement. See
[release gates](RELEASE.md).
