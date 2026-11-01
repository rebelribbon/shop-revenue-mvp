import { HydratedMain } from "@/components/hydrated-main";
import { ActionForm } from "@/components/action-form";
import { listPolicies, POLICY_KINDS } from "@/domain/legal-policy";
import {
  approvePolicyAction,
  createPolicyDraftAction,
  retirePolicyAction,
  updatePolicyDraftAction,
} from "@/server/actions/admin";
import { requireInternal } from "@/server/views/admin";

// I5 Legal policies: create draft version, approve (second admin, attorney memo
// reference), retire. Approved text is immutable.
export default async function Policies() {
  const me = await requireInternal("admin");
  const policies = await listPolicies();
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Legal policies</h1>
      {policies.length === 0 && (
        <p className="muted">
          No policies yet. Production refuses to render documents whose policy
          is not approved.
        </p>
      )}
      {policies.map((p) => (
        <div className="card" key={p.id}>
          <div className="row">
            <strong>
              {p.jurisdictionCode} · {p.kind} · v{p.version}
            </strong>
            <span className="pill">{p.status}</span>
          </div>
          <p className="muted">
            SHA-256 {p.bodySha256.slice(0, 16)}…{" "}
            {p.approvalReference ? `· memo ${p.approvalReference}` : ""}
          </p>
          {p.status === "draft" ? (
            <>
              <ActionForm
                action={updatePolicyDraftAction}
                hidden={{ policyId: p.id }}
                submitLabel="Save draft"
                variant="secondary"
              >
                <label htmlFor={`policy-body-${p.id}`}>Policy text</label>
                <textarea
                  id={`policy-body-${p.id}`}
                  name="body"
                  defaultValue={p.body}
                  required
                />
              </ActionForm>
              {p.createdByInternalUserId === me.id ? (
                <p className="muted">A second admin must approve this draft.</p>
              ) : (
                <ActionForm
                  action={approvePolicyAction}
                  hidden={{ policyId: p.id }}
                  submitLabel="Approve"
                  confirm="Approving makes this text binding and retires the current approved version."
                >
                  <label htmlFor={`ref-${p.id}`}>Attorney memo reference</label>
                  <input id={`ref-${p.id}`} name="approvalReference" required />
                </ActionForm>
              )}
            </>
          ) : (
            <>
              <pre>{p.body}</pre>
              {p.status === "approved" && (
                <ActionForm
                  action={retirePolicyAction}
                  hidden={{ policyId: p.id }}
                  submitLabel="Retire"
                  variant="danger"
                  confirm="Retiring leaves no approved version for this kind until another is approved."
                />
              )}
            </>
          )}
        </div>
      ))}
      <div className="card">
        <h2>New draft version</h2>
        <ActionForm action={createPolicyDraftAction} submitLabel="Create draft">
          <label htmlFor="jurisdictionCode">Jurisdiction</label>
          <input
            id="jurisdictionCode"
            name="jurisdictionCode"
            defaultValue="US-TX"
            required
            pattern="[A-Z]{2}-[A-Z]{2}"
          />
          <label htmlFor="kind">Kind</label>
          <select id="kind" name="kind">
            {POLICY_KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <label htmlFor="body">Text (attorney-provided)</label>
          <textarea id="body" name="body" required />
        </ActionForm>
      </div>
    </HydratedMain>
  );
}
