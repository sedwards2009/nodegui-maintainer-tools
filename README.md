# nodegui-maintainer-tools

Tools to help maintain NodeGui itself

The main tool is used to generate binding code from input C++ method declarations. It is intended to be run from inside VSCode or other text editor as a "call out to shell" style filter which operates on the selection.

The tool can run with `node dist/main.js` and its input should be piped in via stdin.

An extension like "Edit with Shell" in VSCode should be used to call out to a shell script wrapper which invokes the node program itself from the right directory.

The input should have the following format:
```
// CLASS: FooBarWidget
// TODO: int add(int a, int b)
// TODO: int subtract(int a, int b)

```
The first line defines the name of the class these method belong to. This name is used in the generated code. Each method signature should start with `// TODO: `. This means that `TODO` comments inside NodeGui files can be directly expanded.

The result is the generated code, split up into the different code parts such as C++ wrap header, C++ wrapper body, Napi method declarations, and finally the TypeScript code. These parts have to be manually moved to the correct files.

If any error occurs then it forms the whole output.
