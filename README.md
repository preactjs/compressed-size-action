# compressed-size-action

A github action that reports changes in compressed file sizes on your PRs.

- Automatically uses `yarn` or `npm ci` when lockfiles are present
- Builds your PR, then builds the target and compares between the two
- Doesn't upload anything or rely on centralized storage

<img width="396" src="https://user-images.githubusercontent.com/105127/73027546-a0176a80-3e01-11ea-887b-7326ee289893.png">

<img width="600" src="https://user-images.githubusercontent.com/105127/73027489-8413c900-3e01-11ea-8630-09172b247f82.png">


### Usage:

Add a workflow (`.github/workflows/main.yml`):

```yaml
name: Compressed Size

on: [pull_request]

jobs:
  build:

    runs-on: ubuntu-latest

    steps:
    - uses: actions/checkout@v2-beta
      with:
        fetch-depth: 1
    - uses: preactjs/compressed-size-action@v1
      with:
        repo-token: "${{ secrets.GITHUB_TOKEN }}"
```
