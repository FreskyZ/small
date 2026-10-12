
public static class StackTrace
{
    // the 5th frame like object after 3 in IronPython and the ...
    public class StackFrame
    {
        public string FileName { get; set; }
        public string MethodName  { get; set; }
        public int LineNumber { get; set; }
    }

    public static IEnumerable<StackFrame> GetStackTrace()
    {
        var frame = InteretedFrame.CurrentFrame.GetOrCreate(() => null);
        while (frame != null)
        {
            // var interpreter = frame.Interpreter;
            var interpreter = typeof(InterpretedFrame).GetField("Interpreter", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(frame);
            // var debugInfos = interpreter._debugInfos;
            var debugInfos = interpreter.GetType().GetField("_debugInfos", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(interpreter) as DebugInfo[];
            var notClearDebugInfos = debugInfos.Where(i => !i.IsClear).ToArray();
            var debugInfo = DebugInfo.GetMatchingDebugInfo(notClearDebugInfos, frame.InstructionIndex);

            // skip empty _debuginfos, callback to c# in stack trace does not have debugInfo
            if (debugInfo is not null)
            {
                // remove the unexpected \$\d+
                var methodName = frame.name;
                var dollarIndex = methodName.IndexOf('$');
                if (dollarIndex >= 0)
                {
                    methodName = methodName.Substring(0, dollarIndex);
                }
                yield return new StackFrame { FileName = debugInfo.FileName, MethodName = methodName, LineNumber = debugInfo.StartLine };
            }
            frame = frame.Parent;
        }
    }
}
