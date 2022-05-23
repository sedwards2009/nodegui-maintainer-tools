/*
 * Copyright 2021 Simon Edwards <simon@simonzone.com>
 *
 * This source code is licensed under the MIT license which is detailed in the LICENSE.txt file.
 */
import { default as getStdin } from 'get-stdin';

const log = console.log.bind(console);

const classNameRegex = /\/\/\s+CLASS:\s+(?<className>\w+)/;
const propNameRegex = /\/\/\s+PROP:\s+(?<className>\w+)/;
const sigRegex = /\/\/\s+TODO:\s+(virtual\s+)?(?<returnType>[\w:]+)\s+\&?(?<methodName>[A-Za-z0-9]+)[(](?<args>[^)]*)\)/;

// ---- Argument types ----
const SUPPORTED_ARG_TYPES = [
  'GLenum', 'GLfloat', 'GLint', 'GLuint', 'GLsizei', 'GLclampf', 'GLboolean',
  'const QModelIndex', 'int', 'const QPoint', 'QItemSelectionModel::SelectionFlags',
  'QAbstractItemView::CursorAction', 'QAbstractItemView::ScrollHint', 'const QString',
  'QHeaderView::ResizeMode', 'Qt::SortOrder', 'bool', 'Qt::Alignment', 'Qt::Orientation',
  'uint', 'Qt::TextElideMode', 'QSizePolicy::Policy', 'QWidget *', 'QComboBox::InsertPolicy',
  'QComboBox::SizeAdjustPolicy', 'const QSize'
] as const;
type ArgumentTypeName = typeof SUPPORTED_ARG_TYPES[number];

function isSupportedArgType(argName: string): argName is ArgumentTypeName {
  return (<readonly string[]>SUPPORTED_ARG_TYPES).includes(argName);
}

// List of argument types which need to be dereferenced with `*` during the method call.
const DEREFERENCE_TYPES: ArgumentTypeName[] = [
  'const QModelIndex', 'const QPoint', 'const QSize'
];

const TS_WRAPPER_TYPES: ArgumentTypeName[] = [
  'const QModelIndex'
];

// ---- Return types ----
const SUPPORTED_RETURN_TYPES = [
  'void', 'GLfloat', 'GLenum', 'GLboolean', 'GLint', 'GLuint', 'GLclampf',
  'GLsizei', 'bool', 'QModelIndex', 'QModelIndexList', 'Qt::Alignment', 'int',
  'Qt::Orientation', 'Qt::SortOrder', 'QHeaderView::ResizeMode', 'QRect',
  'QString', 'QSize', 'QComboBox::InsertPolicy', 'QComboBox::SizeAdjustPolicy',
  'Qt::ContextMenuPolicy', 'QIcon','Qt::WindowFlags'
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


function parseMethodSignature(signature: string): { args: CppArgument[], methodName: string, returnType: string } {
  const found = signature.match(sigRegex);
  if ( ! found) {
    const result: ExpandedMethodFailedResult = {
      type: 'failed',
      message: `Signature didn't match regex for '${signature}'.`
    };
    throw result;
  }

  const returnTypeString = found.groups.returnType;
  if ( ! isSupportedReturnType(returnTypeString)) {
    const result: ExpandedMethodFailedResult = {
      type: 'failed',
      message: `Return type '${returnTypeString}' is unknown for signature '${signature}'.`
    };
    throw result;
  }
  const returnType: ReturnTypeName = returnTypeString;

  const args = parseArgs(found.groups.args);
  for (const arg of args) {
    if ( ! isSupportedArgType(arg.type)) {
      const result: ExpandedMethodFailedResult = {
        type: 'failed',
        message: `Argument type '${arg.type}' is unknown for signature '${signature}'.`
      };
      throw result;
    }
  }

  return {
    args,
    methodName: found.groups.methodName,
    returnType
  };
}

function expandMethod(className: string, signature: string): ExpandedMethodResult {
  try {
    const { args, methodName, returnType } = parseMethodSignature(signature);
    const methodDeclaration = `  Napi::Value ${methodName}(const Napi::CallbackInfo& info);
`;
    const napiInit = `       InstanceMethod("${methodName}", &${className}Wrap::${methodName}),
`;
    const methodBody = formatCppMethodBody(className, methodName, args, returnType);
    const tsBody = formatTSMethod(methodName, args, returnType);

    const result: ExpandedMethodOkResult = { type: 'ok', methodDeclaration, napiInit, methodBody, tsBody };
    return result;
  } catch(failedResult) {
    return failedResult;
  }
}

function expandProperty(signature: string): ExpandedMethodResult {
  try {
    const { args, methodName, returnType } = parseMethodSignature(signature);

    const tsBody = formatTSProperty(methodName, args, returnType);
    const result: ExpandedMethodOkResult = {
      type: 'ok',
      methodDeclaration: null,
      napiInit: null,
      methodBody: null,
      tsBody
    };

    return result;
  } catch(failedResult) {
    return failedResult;
  }
}

function formatCppMethodBody(className: string, methodName: string, args: CppArgument[], returnType: ReturnTypeName): string {
  let methodBody = `
Napi::Value ${className}Wrap::${methodName}(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
`;

  for (let i=0; i<args.length; i++) {
    const arg = args[i];
    switch (arg.type) {
      case 'GLboolean':
      case 'bool':
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
      case 'uint':
        methodBody += `  ${arg.type} ${arg.name} = info[${i}].As<Napi::Number>().Uint32Value();`;
        break;

      case 'const QModelIndex':
        methodBody += `  QModelIndexWrap* ${arg.name}Wrap = Napi::ObjectWrap<QModelIndexWrap>::Unwrap(info[${i}].As<Napi::Object>());
  QModelIndex* ${arg.name} = ${arg.name}Wrap->getInternalInstance();`;
        break;

      case 'const QPoint':
        methodBody += `  QPointWrap* ${arg.name}Wrap = Napi::ObjectWrap<QPointWrap>::Unwrap(info[${i}].As<Napi::Object>());
  QPoint* ${arg.name} = ${arg.name}Wrap->getInternalInstance();`;
        break;

      case 'const QSize':
        methodBody += `  QSizeWrap* ${arg.name}Wrap = Napi::ObjectWrap<QSizeWrap>::Unwrap(info[${i}].As<Napi::Object>());
  QSize* ${arg.name} = ${arg.name}Wrap->getInternalInstance();`;
        break;

      case 'QItemSelectionModel::SelectionFlags':
        methodBody += `  QItemSelectionModel::SelectionFlags ${arg.name} = static_cast<QItemSelectionModel::SelectionFlags>(info[${i}].As<Napi::Number>().Int32Value());`;
        break;

      case 'QAbstractItemView::CursorAction':
        methodBody += `  QAbstractItemView::CursorAction ${arg.name} = static_cast<QAbstractItemView::CursorAction>(info[${i}].As<Napi::Number>().Int32Value());`;
        break;

      case 'QAbstractItemView::ScrollHint':
        methodBody += `  QAbstractItemView::ScrollHint ${arg.name} = static_cast<QAbstractItemView::ScrollHint>(info[${i}].As<Napi::Number>().Int32Value());`;
        break;

      case 'const QString':
        methodBody += `  std::string ${arg.name}NapiText = info[${i}].As<Napi::String>().Utf8Value();
  QString ${arg.name} = QString::fromUtf8(${arg.name}NapiText.c_str());`;
        break;

      case 'QHeaderView::ResizeMode':
        methodBody += `  QHeaderView::ResizeMode ${arg.name} = static_cast<QHeaderView::ResizeMode>(info[${i}].As<Napi::Number>().Int32Value());`;
        break;

      case 'Qt::SortOrder':
        methodBody += `  Qt::SortOrder ${arg.name} = static_cast<Qt::SortOrder>(info[${i}].As<Napi::Number>().Int32Value());`;
        break;

      case 'QComboBox::InsertPolicy':
        methodBody += `  QComboBox::InsertPolicy ${arg.name} = static_cast<QComboBox::InsertPolicy>(info[${i}].As<Napi::Number>().Int32Value());`;
        break;

      case 'QComboBox::SizeAdjustPolicy':
        methodBody += `  QComboBox::SizeAdjustPolicy ${arg.name} = static_cast<QComboBox::SizeAdjustPolicy>(info[${i}].As<Napi::Number>().Int32Value());`;
        break;

      case 'Qt::TextElideMode':
        methodBody += `  Qt::TextElideMode ${arg.name} = static_cast<Qt::TextElideMode>(info[${i}].As<Napi::Number>().Int32Value());`;
        break;

      case 'Qt::Alignment':
        methodBody += `  Qt::Alignment ${arg.name} = static_cast<Qt::Alignment>(info[${i}].As<Napi::Number>().Int32Value());`;
        break;
      case 'Qt::Orientation':
        methodBody += `  Qt::Orientation ${arg.name} = static_cast<Qt::Orientation>(info[${i}].As<Napi::Number>().Int32Value());`;
        break;
      case 'QSizePolicy::Policy':
        methodBody += `  QSizePolicy::Policy ${arg.name} = static_cast<QSizePolicy::Policy>(info[${i}].As<Napi::Number>().Int32Value());`;
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
    if (DEREFERENCE_TYPES.includes(arg.type)) {
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

    case 'int':
    case 'GLclampf':
    case 'GLfloat':
    case 'GLenum':
    case 'GLint':
    case 'GLuint':
    case 'GLsizei':
      methodBody += `  return Napi::Number::New(env, result);`;
      break;
    case 'Qt::Alignment':
    case 'Qt::Orientation':
    case 'QHeaderView::ResizeMode':
    case 'Qt::SortOrder':
    case 'QComboBox::InsertPolicy':
    case 'QComboBox::SizeAdjustPolicy':
        methodBody += `  return Napi::Number::New(env, static_cast<uint>(result));`;
      break;
    case 'GLboolean':
    case 'bool':
      methodBody += `  return Napi::Boolean::New(env, result);`;
      break;
    case 'QModelIndex':
      methodBody += `  auto resultInstance = QModelIndexWrap::constructor.New(
    {Napi::External<QModelIndex>::New(env, new QModelIndex(result))});
  return resultInstance;`;
      break;
    case 'QModelIndexList':
      methodBody += `  Napi::Array resultArrayNapi = Napi::Array::New(env, result.size());
  for (int i = 0; i < result.size(); i++) {
    resultArrayNapi[i] = QModelIndexWrap::constructor.New({Napi::External<QModelIndex>::New(env, new QModelIndex(result[i]))});
  }
  return resultArrayNapi;`;
      break;
    case 'QRect':
      methodBody += `  auto resultInstance = QRectWrap::constructor.New(
      {Napi::External<QRect>::New(env, new QRect(result))});
    return resultInstance;`;
      break;
    case 'QSize':
      methodBody += `  auto resultInstance = QSizeWrap::constructor.New(
      {Napi::External<QSize>::New(env, new QSize(result))});
    return resultInstance;`;
      break;
    case 'QString':
      methodBody += `  return Napi::String::New(env, result.toStdString());
`;
      break;
    default:
      throw new Error(`Unexpected return type ${returnType} while processing C++ body.`);
  }

  methodBody += `
}
`;
  return methodBody;
}

function formatTSMethod(methodName: string, args: CppArgument[], returnType: ReturnTypeName): string {
  let tsBody = `    ${formatTSMethodName(methodName)}(`;
  tsBody += args.map(arg => `${arg.name}: ${mapCppToTSArgumentType(arg.type, arg.name)}`).join(', ');
  tsBody += `): ${mapCppToTsReturnType(returnType)} {
`;

  let methodCall = '';
  methodCall += `this.native.${methodName}(`;
  methodCall += args.map((arg): string => {
    if (TS_WRAPPER_TYPES.includes(arg.type)) {
      return `${arg.name}.native`;
    } else {
      return arg.name;
    }
  }).join(', ');
  methodCall += `)`;

  switch (returnType) {
    case 'void':
      tsBody += `${methodCall};
`;
      break;
    case 'QModelIndex':
      tsBody += `        return new QModelIndex(${methodCall});
`;
      break;
    case 'QModelIndexList':
      tsBody += `        const methodResult = ${methodCall};
        return methodResult.map((item: any) => new QModelIndex(item));
`;
      break;
    case 'QRect':
      tsBody += `        return new QRect(${methodCall});
`;
      break;
    case 'QSize':
        tsBody += `        return new QSize(${methodCall});
`;
        break;
    default:
      tsBody += `        return ${methodCall};
`;
  }
  tsBody += `    }
`;
  return tsBody;
}


function mapCppToTsReturnType(returnType: string): string {
  switch (returnType) {
    case 'void':
      return 'void';
    case 'GLboolean':
    case 'bool':
      return 'boolean';
    case 'int':
    case 'GLenum':
    case 'GLfloat':
    case 'GLint':
    case 'GLuint':
    case 'GLsizei':
      return 'number';
    case 'QModelIndex':
      return returnType;
    case 'QModelIndexList':
      return 'QModelIndex[]';
    case 'QRect':
      return 'QRect';
    case 'Qt::Alignment':
      return 'AlignmentFlag';
    case 'Qt::Orientation':
      return 'Orientation';
    case 'QHeaderView::ResizeMode':
      return 'QHeaderViewResizeMode';
    case 'Qt::SortOrder':
      return 'SortOrder';
    case 'QComboBox::InsertPolicy':
      return 'InsertPolicy';
    case 'QComboBox::SizeAdjustPolicy':
      return 'SizeAdjustPolicy';
    case 'Qt::TextElideMode':
      return 'TextElideMode';
    case 'QSize':
      return 'QSize';
    case 'Qt::ContextMenuPolicy':
      return 'ContextMenuPolicy';
    case 'Qt::WindowFlags':
      return 'WindowFlags';
    case 'QString':
      return 'string';
    case 'QIcon':
      return 'QIcon';
    default:
      throw new Error(`Unexpected return type ${returnType} while processing TypeScript.`);
  }
}

function mapCppToTSArgumentType(argType: string, argName: string): string {
  switch(argType) {
    case 'GLboolean':
    case 'bool':
      return `boolean`;
    case 'GLclampf':
    case 'GLenum':
    case 'GLfloat':
    case 'GLint':
    case 'GLuint':
    case 'GLsizei':
    case 'int':
    case 'uint':
      return `number`;
    case 'const QModelIndex':
      return 'QModelIndex';
    case 'const QPoint':
      return 'QPoint';
    case 'const QSize':
      return 'QSize';
    case 'QItemSelectionModel::SelectionFlags':
      return 'SelectionFlag';
    case 'QAbstractItemView::CursorAction':
      return 'CursorAction';
    case 'QAbstractItemView::ScrollHint':
      return 'ScrollHint';
    case 'QHeaderView::ResizeMode':
      return 'QHeaderViewResizeMode';
    case 'Qt::SortOrder':
      return 'SortOrder';
    case 'QComboBox::InsertPolicy':
      return 'InsertPolicy';
    case 'QComboBox::SizeAdjustPolicy':
      return 'SizeAdjustPolicy';
    case 'Qt::TextElideMode':
      return 'TextElideMode';
    case 'Qt::Alignment':
      return 'AlignmentFlag';
    case 'Qt::Orientation':
      return 'Orientation';
    case 'const QString':
      return 'string';
    case 'QSizePolicy::Policy':
      return 'QSizePolicyPolicy';
    default:
      throw new Error(`Unexpected argument type ${argName} while processing TypeScript.`);
  }
}

function formatTSProperty(methodName: string, args: CppArgument[], returnType: ReturnTypeName): string {
  let tsBody = `    ${formatTSMethodName(methodName)}(`;
  tsBody += args.map(arg => `${arg.name}: ${mapCppToTSArgumentType(arg.type, arg.name)}`).join(', ');
  tsBody += `): ${mapCppToTsReturnType(returnType)} {
`;

  switch (returnType) {
    case 'void':
      tsBody += `this.setProperty('${methodName[3].toLowerCase()}${methodName.slice(4)}', ${args.map((arg): string => arg.name).join(', ')});
`;
      break;

    case 'bool':
      tsBody += `        return this.property('${methodName}').toBool();
`;
      break;
    case 'QString':
      tsBody += `        return this.property('${methodName}').toString();
`;
      break;

    case 'Qt::WindowFlags':
    case 'Qt::ContextMenuPolicy':
    case 'int':
    case 'uint':
      tsBody += `        return this.property('${methodName}').toInt();
`;
      break;

    case 'QRect':
      tsBody += `        return QRect.fromQVariant(this.property('${methodName}'));
`;
        break;

    case 'QSize':
      tsBody += `        return QSize.fromQVariant(this.property('${methodName}'));
`;
      break;

    case 'QIcon':
      tsBody += `        return QIcon.fromQVariant(this.property('${methodName}'));
`;
      break;

    default:
      tsBody += `        return this.property('${methodName}');
`;
  }
  tsBody += `    }
`;
  return tsBody;
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

  let found = lines[lineNumber].match(classNameRegex);
  let isProp = false;
  if ( ! found) {
    found = lines[lineNumber].match(propNameRegex)
    if ( ! found) {
      log(`ERROR: Unable to find CLASS or PROP comment. i.e. // CLASS: FooBarWidget`);
      return;
    }
    isProp = true;
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

    let result: ExpandedMethodResult;
    if (isProp) {
      result = expandProperty(trimLine);
    } else {
      result = expandMethod(className, trimLine);
    }

    switch (result.type) {
      case 'ok':
        const { methodDeclaration, napiInit, methodBody, tsBody } = <ExpandedMethodOkResult> result;
        if (methodDeclaration != null) {
          cppDeclaration.push(methodDeclaration);
        }

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
  log(`// CLASS: ${className}`);

  if (cppDeclaration.length !== 0) {
    log('//----------------------------------------------------');
    log('// C++ declaration');
    log(cppDeclaration.join(''));
    log('');
  }

  if (napiInitBlock.length !== 0) {
    log('//----------------------------------------------------');
    log('// Napi declaration');
    log(napiInitBlock.join(''));
    log('');
  }

  if (bodyBlock.length !== 0) {
    log('//----------------------------------------------------');
    log('// C++ body');
    log(bodyBlock.join(''));
    log('');
  }

  log('//----------------------------------------------------');
  log('// TS body');
  log(tsBlock.join(''));
}

async function main(): Promise<void> {
  const input = await getStdin();
  process(input);
}
main();
