/*
 * Copyright 2021 Simon Edwards <simon@simonzone.com>
 *
 * This source code is licensed under the MIT license which is detailed in the LICENSE.txt file.
 */
import { default as getStdin } from 'get-stdin';

const log = console.log.bind(console);

const classNameRegex = /\/\/\s+CLASS:\s+(?<className>\w+)/;
const sigRegex = /\/\/\s+TODO:\s+(?<returnType>\w+)\s+\&?(?<methodName>[A-Za-z0-9]+)[(](?<args>[^)]*)\)/;

// ---- Argument types ----
const SUPPORTED_ARG_TYPES = [
  'GLenum', 'GLfloat', 'GLint', 'GLuint', 'GLsizei', 'GLclampf', 'GLboolean', 'const QModelIndex', 'int'
] as const;
type ArgumentTypeName = typeof SUPPORTED_ARG_TYPES[number];

function isSupportedArgType(argName: string): argName is ArgumentTypeName {
  return (<readonly string[]>SUPPORTED_ARG_TYPES).includes(argName);
}

// List of argument types which need to be deferenced with `*` during the method call.
const DEFERENCE_TYPES: ArgumentTypeName[] = [
  'const QModelIndex'
];

// ---- Return types ----
const SUPPORTED_RETURN_TYPES = [
  'void', 'GLfloat', 'GLenum', 'GLboolean', 'GLint', 'GLuint', 'GLclampf', 'GLsizei', 'bool'
];
type ReturnTypeName = typeof SUPPORTED_RETURN_TYPES[number];

function isSupportedReturnType(returnName: string): returnName is ReturnTypeName {
  return (<readonly string[]>SUPPORTED_RETURN_TYPES).includes(returnName);
}


interface ExpandedMethodOkResult {
  readonly type: 'ok',
  readonly methodDeclaration: string;
  readonly napiInit: string;
  readonly methodBody: string;
  readonly tsBody: string;
}

interface ExpandedMethodFailedResult {
  readonly type: 'failed',
  readonly message: string;
}

type ExpandedMethodResult = ExpandedMethodOkResult | ExpandedMethodFailedResult;


function expandMethod(className: string, signature: string): ExpandedMethodResult {
  const found = signature.match(sigRegex);
  if ( ! found) {
    const result: ExpandedMethodFailedResult = {
      type: 'failed',
      message: `Signature didn't match regex for '${signature}'.`
    };
    return result;
  }

  const returnTypeString = found.groups.returnType;
  if ( ! isSupportedReturnType(returnTypeString)) {
    const result: ExpandedMethodFailedResult = {
      type: 'failed',
      message: `Return type '${returnTypeString}' is unknown for signature '${signature}'.`
    };
    return result;
  }
  const returnType: ReturnTypeName = returnTypeString;

  const args = parseArgs(found.groups.args);
  for (const arg of args) {
    if ( ! isSupportedArgType(arg.type)) {
      const result: ExpandedMethodFailedResult = {
        type: 'failed',
        message: `Argument type '${arg.type}' is unknown for signature '${signature}'.`
      };
      return result;
    }
  }

  const methodName = found.groups.methodName;
  const methodDeclaration = `  Napi::Value ${methodName}(const Napi::CallbackInfo& info);
`;
  const napiInit = `       InstanceMethod("${methodName}", &${className}Wrap::${methodName}),
`;
  let methodBody = `
Napi::Value ${className}Wrap::${methodName}(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::HandleScope scope(env);
`;

  for (let i=0; i<args.length; i++) {
    const arg = args[i];
    switch (arg.type) {
      case 'GLboolean':
        methodBody += `  ${arg.type} ${arg.name} = info[${i}].As<Napi::Boolean>().Value();`;
        break;
      case 'GLclampf':
      case 'GLfloat':
        methodBody += `  ${arg.type} ${arg.name} = info[${i}].As<Napi::Number>().FloatValue();`;
        break;
      case 'GLenum':
      case 'GLint':
      case 'GLsizei':
      case 'int':
        methodBody += `  ${arg.type} ${arg.name} = info[${i}].As<Napi::Number>().Int32Value();`;
        break;
      case 'GLuint':
        methodBody += `  ${arg.type} ${arg.name} = info[${i}].As<Napi::Number>().Uint32Value();`;
        break;

      case 'const QModelIndex':
        methodBody += `  QModelIndexWrap* ${arg.name}Wrap = Napi::ObjectWrap<QModelIndexWrap>::Unwrap(info[${i}].As<Napi::Object>());
  QModelIndex* ${arg.name} = ${arg.name}Wrap->getInternalInstance();`;
        break;

      default:
    }
    methodBody += `
`;
  }

  switch (returnType) {
    case 'void':
      methodBody += `  `;
      break;
    default:
      methodBody += `  ${returnType} result = `;
      break;
  }

  methodBody += `this->instance->${methodName}(`;
  methodBody += args.map(arg => {
    if (DEFERENCE_TYPES.includes(arg.type)) {
      return `*${arg.name}`;
    } else {
      return arg.name;
    }
  }).join(', ');
  methodBody += `);
`;

  switch (returnType) {
    case 'void':
      methodBody += `  return env.Null();`;
      break;

    case 'GLclampf':
    case 'GLfloat':
    case 'GLenum':
    case 'GLint':
    case 'GLuint':
    case 'GLsizei':
        methodBody += `  return Napi::Number::New(env, result);`;
      break;

    case 'GLboolean':
    case 'bool':
      methodBody += `  return Napi::Boolean::New(env, result);`;
      break;

    default:
      throw new Error(`Unexpected return type ${returnType} while processing C++ body.`);
  }

methodBody += `
}
`;

  // --- TypeScript ---
  let tsBody = `    ${formatTSMethodName(methodName)}(`;
  let comma = '';
  for (const arg of args) {
    tsBody += comma;
    comma = ', ';

    tsBody += `${arg.name}: `;
    switch(arg.type) {
      case 'GLboolean':
        tsBody += `boolean`;
        break;
      case 'GLclampf':
      case 'GLenum':
      case 'GLfloat':
      case 'GLint':
      case 'GLuint':
      case 'GLsizei':
      case 'int':
        tsBody += `number`;
        break;
      case 'const QModelIndex':
        tsBody += 'QModelIndex';
        break;
      default:
        throw new Error(`Unexpected argument type ${arg.name} while processing TypeScript.`);
    }
  }
  tsBody += `): `;

  switch (returnType) {
    case 'void':
      tsBody += 'void';
      break;

    case 'GLboolean':
    case 'bool':
      tsBody += 'boolean';
      break;

    case 'GLenum':
    case 'GLfloat':
    case 'GLint':
    case 'GLuint':
    case 'GLsizei':
      tsBody += 'number';
      break;

    default:
      break;
  }
  tsBody += ` {
`;

  if (returnType != 'void') {
    tsBody += `        return `;
  } else {
    tsBody += `        `;
  }

  tsBody += `this.native.${methodName}(`;
  tsBody += args.map(arg => arg.name).join(', ');
  tsBody += `);
    }

`;

  const result: ExpandedMethodOkResult = { type: 'ok', methodDeclaration, napiInit, methodBody, tsBody };
  return result;
}

interface CppArgument {
  type: ArgumentTypeName;
  name: string;
}

function parseArgs(args: string): CppArgument[] {
  const parts = args.split(',');
  const result = [];

  for (const part of parts) {
    const argParts = part.trim().split(' ');
    const type = argParts.slice(0, argParts.length-1).join(' ');
    let name = argParts[argParts.length-1];
    if (name.startsWith('&')) {
      name = name.substr(1);
    }
    if (name != "") {
      result.push({type, name});
    }
  }

  return result;
}

function formatTSMethodName(methodName: string): string {
  if (methodName.startsWith('gl')) {
    const body = methodName.substr(2);
    return body.substr(0, 1).toLowerCase() + body.substr(1);
  } else {
    return methodName;
  }
}


function process(inputString: string): void {
  const lines = inputString.split('\n');

  let lineNumber = 0;

  while (lines[lineNumber].trim() === '' && lineNumber < lines.length) {
    lineNumber++;
  }
  if (lineNumber === lines.length) {
    log(`ERROR: No non-blank lines were found.`);
    return;
  }

  const found = lines[lineNumber].match(classNameRegex);
  if ( ! found) {
    log(`ERROR: Unable to find CLASS comment. i.e. // CLASS: FooBarWidget`);
    return;
  }
  const className = found.groups.className;
  lineNumber++;

  const cppDeclaration: string[] = [];
  const napiInitBlock: string[] = [];
  const bodyBlock: string[] = [];
  const tsBlock: string[] = [];
  for (; lineNumber<lines.length; lineNumber++) {
    const trimLine = lines[lineNumber].trim()
    if (trimLine === '') {
      continue;
    }

    const result = expandMethod(className, trimLine);
    switch (result.type) {
      case 'ok':
        const { methodDeclaration, napiInit, methodBody, tsBody } = <ExpandedMethodOkResult> result;
        cppDeclaration.push(methodDeclaration);

        if (napiInit != null) {
          napiInitBlock.push(napiInit);
        }

        if (methodBody != null) {
          bodyBlock.push(methodBody);
        }
        if (tsBody != null) {
          tsBlock.push(tsBody);
        }
        break;

      case 'failed':
        log(`>>> ERROR: ${result.message}`);
        return;
    }
  }

  log('//----------------------------------------------------');
  log('// C++ declaration');
  log(cppDeclaration.join(''));
  log('');

  log('//----------------------------------------------------');
  log('// Napi declaration');
  log(napiInitBlock.join(''));
  log('');

  log('//----------------------------------------------------');
  log('// C++ body');
  log(bodyBlock.join(''));
  log('');

  log('//----------------------------------------------------');
  log('// TS body');
  log(tsBlock.join(''));
}

async function main(): Promise<void> {
  const input = await getStdin();
  process(input);
}
main();
