/*
 * Copyright 2021 Simon Edwards <simon@simonzone.com>
 *
 * This source code is licensed under the MIT license which is detailed in the LICENSE.txt file.
 */
import { default as getStdin } from 'get-stdin';

const log = console.log.bind(console);

// const sigRegex = /$\/\/\w+\s+\w+[(][^)]+[)]^/;
const sigRegex = /\/\/(?<returnType>\w+)\s+(?<methodName>\w+)[(](?<args>[^)]*)\)/;


const SUPPORTED_ARG_TYPES = [
  'GLenum', 'GLfloat', 'GLint', 'GLuint', 'GLsizei', 'GLclampf', 'GLboolean'
] as const;
type ArgumentTypeName = typeof SUPPORTED_ARG_TYPES[number];

function isSupportedArgType(argName: string): argName is ArgumentTypeName {
  return (<readonly string[]>SUPPORTED_ARG_TYPES).includes(argName);
}

const SUPPORTED_RETURN_TYPES = [
  'void', 'GLfloat', 'GLenum', 'GLboolean', 'GLint', 'GLuint', 'GLclampf', 'GLsizei'
];
type ReturnTypeName = typeof SUPPORTED_RETURN_TYPES[number];

function isSupportedReturnType(returnName: string): returnName is ReturnTypeName {
  return (<readonly string[]>SUPPORTED_ARG_TYPES).includes(returnName);
}


interface ExpandedMethod {
  methodDeclaration: string;
  napiInit: string;
  methodBody: string;
  tsBody: string;
}

function expandMethod(className: string, signature: string): ExpandedMethod {
  const found = signature.match(sigRegex);
  if ( ! found) {
    return null;
  }

  const returnTypeString = found.groups.returnType;
  if ( ! isSupportedReturnType(returnTypeString)) {
    return null;
  }
  const returnType: ReturnTypeName = returnTypeString;

  const args = parseArgs(found.groups.args);
  for (const arg of args) {
    if ( ! isSupportedArgType(arg.type)) {
      return null;
    }
  }

  const methodName = found.groups.methodName;

  const methodDeclaration = `  Napi::Value ${methodName}(const Napi::CallbackInfo& info);`;
  const napiInit = `       InstanceMethod("${methodName}", &${className}Wrap::${methodName}),
`;
  let methodBody = `
Napi::Value ${className}Wrap::${methodName}(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::HandleScope scope(env);

  if (info.Length() != ${args.length}) {
    Napi::TypeError::New(env, "Wrong number of arguments")
        .ThrowAsJavaScriptException();
  }
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
        methodBody += `  ${arg.type} ${arg.name} = info[${i}].As<Napi::Number>().Int32Value();`;
        break;
      case 'GLuint':
        methodBody += `  ${arg.type} ${arg.name} = info[${i}].As<Napi::Number>().Uint32Value();`;
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
  methodBody += args.map(arg => arg.name).join(', ');
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
        tsBody += `number`;
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

  return { methodDeclaration, napiInit, methodBody, tsBody };
}

interface CppArgument {
  type: string;
  name: string;
}

function parseArgs(args: string): CppArgument[] {
  const parts = args.split(',');
  const result = [];

  for (const part of parts) {
    const argParts = part.trim().split(' ');
    const type = argParts.slice(0, argParts.length-1).join(' ');
    const name = argParts[argParts.length-1];
    if (name != "") {
      result.push({type, name});
    }
  }

  return result;
}

/**
 * @param {string} methodName
 * @returns {string}
 */
function formatTSMethodName(methodName) {
  if (methodName.startsWith('gl')) {
    const body = methodName.substr(2);
    return body.substr(0, 1).toLowerCase() + body.substr(1);
  } else {
    return methodName;
  }
}


function processMethods(className: string, methodStrList: string): void {
  const methodList = methodStrList.split('\n').filter(line => line.trim() !== '');
  let napiInitBlock = '';
  let bodyBlock = '';
  let tsBlock = '';
  for (let i=0; i<methodList.length; i++) {
    const result = expandMethod(className, methodList[i]);
    if (result != null) {
      const { methodDeclaration, napiInit, methodBody, tsBody } = result;
      methodList[i] = methodDeclaration;

      if (napiInit != null) {
        napiInitBlock = napiInitBlock + napiInit;
      }

      if (methodBody != null) {
        bodyBlock = bodyBlock + methodBody;
      }
      if (tsBody != null) {
        tsBlock = tsBlock + tsBody;
      }
    }
  }

  log('//----------------------------------------------------');
  log('// C++ declaration');
  log(methodList.join('\n'));
  log('');

  log('//----------------------------------------------------');
  log('// Napi declaration');
  log(napiInitBlock);
  log('');

  log('//----------------------------------------------------');
  log('// C++ body');
  log(bodyBlock);
  log('');

  log('//----------------------------------------------------');
  log('// TS body');
  log(tsBlock);
}

// processMethods('QOpenGLExtraFunctions', methodStrList2);

// processMethods('QOpelGLExtraFunctions', `
// //GLenum 	 glGetError()
// `);



async function main(): Promise<void> {
  const input = await getStdin();
  log(`|${input}|`);
}
main();
