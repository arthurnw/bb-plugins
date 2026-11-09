# Change Breakdown

Splits a thread's changed lines into Code, Tests, Mocks, Generated and Docs. Each group lists its file count and `+N −M`, and expands to its files. The total compares the thread's environment against its merge base branch, including uncommitted changes.

Files are classified by path; see `classify` in `shared.ts`.
