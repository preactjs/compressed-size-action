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
    - uses: actions/checkout@v2
    - uses: preactjs/compressed-size-action@v1
      with:
        repo-token: "${{ secrets.GITHUB_TOKEN }}"
```

### Customizing the Build

By default, `compressed-size-action` will try to build your PR by running the `"build"` [npm script](https://docs.npmjs.com/misc/scripts) in your `package.json`.

If you need to perform some tasks after dependencies are installed but before building, you can use a "postinstall" npm script to do so. For example, in Lerna-based monorepo:

```json
{
  "scripts": {
    "postinstall": "lerna bootstrap",
    "build": "lerna run build"
  }
}
```

It is also possible to define a `"prebuild"` npm script, which runs after `"postinstall"` but before `"build"`.

You can also specify a completely different [npm script](https://docs.npmjs.com/misc/scripts) to run instead of the default (`"build"`). To do this, add a **`build-script` option** to your `yml` workflow:

```diff
name: Compressed Size

on: [pull_request]

jobs:
  build:

    runs-on: ubuntu-latest

    steps:
    - uses: actions/checkout@v2
    - uses: preactjs/compressed-size-action@v1
      with:
        repo-token: "${{ secrets.GITHUB_TOKEN }}"
+       build-script: "ci"
```
