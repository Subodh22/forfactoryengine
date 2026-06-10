import { Octokit } from "@octokit/rest";

function octo(token: string) {
  return new Octokit({ auth: token });
}

/** Validate a token and return the authenticated user's login (or throw). */
export async function getUser(token: string): Promise<{ login: string }> {
  const { data } = await octo(token).users.getAuthenticated();
  return { login: data.login };
}

export interface RepoSummary {
  fullName: string;
  defaultBranch: string;
  private: boolean;
  description: string | null;
}

/** The authenticated user's repos, most-recently-pushed first (capped). */
export async function fetchUserRepos(token: string): Promise<RepoSummary[]> {
  const client = octo(token);
  const repos: RepoSummary[] = [];
  for await (const res of client.paginate.iterator(client.repos.listForAuthenticatedUser, {
    sort: "pushed",
    per_page: 100,
  })) {
    for (const r of res.data) {
      repos.push({
        fullName: r.full_name,
        defaultBranch: r.default_branch,
        private: r.private,
        description: r.description ?? null,
      });
    }
    if (repos.length >= 200) break;
  }
  return repos;
}

export async function createPR(
  token: string, owner: string, repo: string, head: string, base: string, title: string, body: string,
): Promise<{ url: string; number: number }> {
  try {
    const { data } = await octo(token).pulls.create({ owner, repo, head, base, title, body });
    return { url: data.html_url, number: data.number };
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 422 && /pull request already exists/i.test(e.message ?? "")) {
      // PR already open for this branch — find and return it
      const { data: prs } = await octo(token).pulls.list({ owner, repo, head: `${owner}:${head}`, base, state: "open" });
      if (prs.length > 0) return { url: prs[0]!.html_url, number: prs[0]!.number };
    }
    throw err;
  }
}

export interface CreatedRepo { fullName: string; defaultBranch: string; htmlUrl: string }

/** Create a brand-new repo on the authenticated user's account, seeded with an
 *  initial commit so it's immediately cloneable. */
export async function createRepo(
  token: string, name: string, description: string, isPrivate: boolean,
): Promise<CreatedRepo> {
  try {
    const { data } = await octo(token).repos.createForAuthenticatedUser({
      name,
      description: description || undefined,
      private: isPrivate,
      auto_init: true,
    });
    return { fullName: data.full_name, defaultBranch: data.default_branch, htmlUrl: data.html_url };
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 422 && /already exists/i.test(e.message ?? "")) {
      throw new Error(`A repository named "${name}" already exists on your GitHub account. Choose a different name.`);
    }
    throw err;
  }
}
