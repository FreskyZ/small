# IronPython StackTrace

more specifically, get stack trace for log purpose *without* throwing exception

NOTE at archive time, this is written at about 2023 and may not match current IronPython code, but IronPython project
changes really very super ultra pro max slow, so you can easily scroll back history if there is a source code mismatch

the standard answer is `traceback.extract_stack`, the `traceback` module seems mainly work on trace back information
of thrown exception, except this method accept an optional first parameter and extract information from current stack
frame, next standard answer is `inspect.stack`, which seems more dedicated for this inspection purpose, which is newer
and has slightly nicer api and data structure

both of them do NOT work in IronPython

these 2 methods always print line number 1 for all stack frames, they both use `sys._getframe()` as data source, which
corresponds to IronPython C# `IronPython.Modules.SysModule._getframeImpl` method, whose data come
from `IronPython.Runtime.Operations.PythonOps.GetFunctionStack()`, stored as thread static variable
in `IronPython.Runtime.Operations.PythonOps._funcStack`, which is of type
`List<IronPython.Runtime.Operations.FunctionStack>`, which contains the actual function name, line number and other
frame properties, the `_lineNo` field, although exposed by the `f_lineno` python property, is not actually set by any
source code, the field itself, is only set in method `IronPython.Runtime.PythonTracebackListener.OnTraceEvent`, as the
name indicates, is related to IronPython's implementation detail of `sys.settrace` mechanism, this can be proved by
enabling trace by calling `Microsoft.Scripting.Hosting.ScriptEngine.SetTrace` method and provide any callback (include
noop), and then use the `ScriptEngine.GetSysModule()._getframeImpl` method and see the reasonable correct value in
result line numbers, other detials in the `OnTraceEvent` indicates that the line numbers actually come from trace
mechanism, nearly every event will set line number according to related ast node position information

use settrace is NOT acceptable for logging purpose because it will significantly impact overall performance

by the way, the trace feature was actually used in this program to enable real debuggin experience of the rule engine,
user is able to set breakpoints to pause the program, execute step by step, inspect local variables and perform other
debugging operations, the functionality is extremely prototype, only have command line interface and do not cooperate
with real workflows in this program and discarded many years ago

by the way again, the original logging line number attempt, at December 2018, also failed because of this reason, at
which time I blame the architecture of rule engine that library code and user code are executed in different ironpython
engine instance, which is designed to prevent executing library code every time user code is to be executed, this is
proved to be not true because previous experiment works with this architecture

while on the other side, exception thrown in library code can correctly display all line numbers without using trace,
this information is stored in `IronPython.Runtime.Exceptions.IPythonAwareException.Frames` property `Exception.Data`
additional data dictionary, which have type `List<Microsoft.Scripting.Runtime.DynamicStackFrame>`, which is another
frame-like type different from `TracebackFrame`, this property is only set
in `IronPython.Runtime.Exceptions.PythonExceptions.SetFrameList` method (note the difference between
`IPythonAwareException`'s source code file `IronPython\Runtime\Exceptions\PythonException.cs` and `PythonExceptions`
class's `IronPython\Runtime\Exceptions\PythonExceptions.cs`), this method is only called
in `IronPytthon.Runtime.Operations.PythonOps.UpdateStackFrame` method, this method is called in 3 places, but the only
place that is possible to pass non zero values is `IronPython.Compiler.Ast.AstMethods.UpdateStackTrace` property, which
is only called by `IronPython.Compiler.Ast.ScopeStatement.UpdateStackTrace` method, this method is directly or
indirectly called by several ast node parsers include class definition, function definition, body, try statement, etc.
all of them are related to exception handling, the linq expression to call `UpdateStrackTrace`
use `IronPython.Compiler.Ast.Node.LineNumberExpression` property as the line number parameter, which originaly comes
from ast node position information, all of this shows that the IronPython compiler, is generating special code around
throw statement and the may-throw functions, assigning line number and other stack trace information to the exception
object exactly when it's thrown,

which looks cool and looks like better performance, which may not be true compare to move these operations into static
code, if possible, that static code is compiled at library compile time, and may be inlined into linq expression JIT'd
result or run with other static code called from within linq expression, which should be more performance than always
JIT compile static operation at application run time,

hope you are not confused by those "times" when talking about language runtime (which also contains a "time"),

- IronPython compile time is the time to build IronPython C# source code into libraries published to nuget registry
- IronPython compile time is the time to build python source code string into IronPython ast data structures and into
  linq expression data structures
- linq JIT time is the time to convert linq expression to MSIL code
- .NET runtime JIT time is the time to convert MSIL code into native CPU instructions

(and if you come from future that dotnet AOT is widely used, that's completely not suitable for IronPython and the DLR
(Microsoft Dynamic Language Runtime), which is really dynamic and cannot be ahead of time)

deliberately throw exception is NOT acceptable for logging purpose because it will significantly affect performance

to be more confusing, there is another `Microsoft.Scripting.Interpreter.InterpretedFrameInfo` key in `Exception.Data`
dictionary which have type list of `InterpretedFrameInfo`, note this type is 
in `Microsoft.Dynamic/Interpreter/LightCompiler.cs` file,
not `Microsoft.Scripting` project the similar `InterpretedFrame.cs` file, the type is only constructed
in `Microsoft.Scripting.Interpreter.InterpretedFrame.GetStackTraceDebugInfo` method, which is only called
by `Microsoft.Scripting.Interpreter.InterpretedFrame.SaveTraceToException` method, which exactly save the result
into `Exception.Data` dictionary, which is only called in `Microsoft.Scripting.Interpreter.Interpreter.HandleException`
method, which is only called in `Microsoft.Scripting.Interpreter.Interpreter.Run`, which is called by various
reflection/generated code magic, randomly navigate through these call hierarchy may lead you 
to `IronPython.Modules.Builtin.eval`method, and event the previous `ScriptEngine.SetTrace`
and `PythonOps.UpdateStackTrace` methods, and finally the `ScriptSource.Run` and `CompiledCode.Run` method, that
obviously is called in application source code, on the other direction, the `GetStrackTraceDebugInfo` method internally
calls `Microsoft.Scripting.Interpreter.DebugInfo.GetMatchingDebugInfo` method given
the `Microsoft.Scripting.Interpreter.Interpreter._debugInfos` array and
the `Microsoft.Scripting.Interpreter.InterpretedFrame.InstructionIndex` value, which means the interpreter already
stores the `DebugInfo` information without `settrace` mechanism and an exception really throw, which makes previous
2 approaches and their own frame type and stack trace information more confusing

the current fame, the current `InterpretedFrame` object, although not available through the `sys._getframe` function,
is directly available at `InterepretedFrame.CurrentFrame` thread local static variable, which is stored every time when
an `InterpretedFrame` object is created, and an experiment program shows it works,

except a few frames have unreasonable line number 16707566 (not 16777216), to make things more confusing, the most
important frame, the last frame in user code to let user locate direct source code to trigger logging, is always this
value, tweak compiler options and detailed api invocation operation do not fix this issue, by inspect
into `DebugInfo` object, it shows a `DebugInfo.IsClear` property is set, this field is only set by linq expression
`System.Linq.Expressions.DebugInfoExpression.IsClear` property, which I don't heard of after implementing a real jit'd
production level rule engine with much experience about linq expressions, this property have no direct reference in
IronPython source code, goes into `System.Linq` source code (https://github.com/dotnet/runtime/blob/main/src/libraries/System.Linq.Expressions/src/System/Linq/Expressions/DebugInfoExpression.cs)
you can see it throws exception in exactly every method and property which makes the class itself not usable, the
answer is at `System.Linq.Expressions.Expression.DebugInfo` helper function is actually creating a derived
`SpanDebugInfoExpression` class object, or an alternative `System.Linq.Expressions.Expression.ClearDebugInfo` helper
function to create a derived `ClearDebugInfoExpression` which have `IsClear` property always returning true, and make
the `StartLine` and `EndLine` property always return 0xFEEFEE which is exactly 16707566 in decimal, these helper
functions are called in `Microsoft.Scripting.Ast.Utils.AddDebugInfo` method, which is only called
by `IronPython.Compiler.Ast.ScopeStatement.AddDebugInfo` method, which is called by various ast transformers, on the
other side, the `AddDebugInfo` method always adds `DebugInfoExpression` before and `ClearDebugInfoExpression` after,
in a pair surrounding normal linq expression nodes, look into
`Microsoft.Scripting.Interpreter.DebugInfo.GetMatchingDebugInfo` method, it looks like unexpectedly find a cleared
debug info, the debug info array in `Interpreter` is a sparse array associated with interpreted frame instruction
index, and the find method finds the nearest but less entry for current instruction index, but the nearest but larger
entry seems have correct line number value, and manually fix this issue seems successful

by the way, the magic 16707566 value is not first time to appear, when the program upgrade IronPython 2 to IronPython3,
it appears in exception stack trace, it's not major issue and I simply manually overwrite this value to 0, that's
actually because the exception stack trace formatting utility in this program have too strict type sanity check in
reflection magic, and fix the sanity check successfully fixed the issue

by the way again, the result method name information unexpected contain a '\$\d+' part after upgrade to IronPython3, I
can find the related source code which add this postfix, but cannot find a reason, they are manually excluded in result
implementation and may be investigated in future
