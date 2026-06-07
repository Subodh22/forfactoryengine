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
  const { data } = await octo(token).pulls.create({ owner, repo, head, base, title, body });
  return { url: data.html_url, number: data.number };
}
