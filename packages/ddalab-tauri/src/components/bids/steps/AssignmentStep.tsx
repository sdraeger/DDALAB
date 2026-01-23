"use client";

import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BIDSFileAssignment } from "@/types/bidsExport";
import { Plus } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface AssignmentStepProps {
  files: BIDSFileAssignment[];
  updateFileAssignment: (
    sourcePath: string,
    updates: Partial<BIDSFileAssignment>,
  ) => void;
}

export function AssignmentStep({
  files,
  updateFileAssignment,
}: AssignmentStepProps) {
  const [subjects, setSubjects] = useState<string[]>(["01"]);
  const [sessions, setSessions] = useState<string[]>([]);

  const uniqueSubjects = useMemo(() => {
    const fromFiles = files.map((f) => f.subjectId).filter(Boolean);
    return [...new Set([...subjects, ...fromFiles])].sort();
  }, [files, subjects]);

  const uniqueSessions = useMemo(() => {
    const fromFiles = files
      .map((f) => f.sessionId)
      .filter((s): s is string => !!s);
    return [...new Set([...sessions, ...fromFiles])].sort();
  }, [files, sessions]);

  const addSubject = () => {
    const nextNum = uniqueSubjects.length + 1;
    const newId = nextNum.toString().padStart(2, "0");
    if (!uniqueSubjects.includes(newId)) {
      setSubjects([...subjects, newId]);
    }
  };

  const addSession = () => {
    const nextNum = uniqueSessions.length + 1;
    const newId = nextNum.toString().padStart(2, "0");
    if (!uniqueSessions.includes(newId)) {
      setSessions([...sessions, newId]);
    }
  };

  const setAllTask = (task: string) => {
    files.forEach((file) => {
      updateFileAssignment(file.sourcePath, { task });
    });
  };

  const autoNumberRuns = () => {
    const groups = new Map<string, BIDSFileAssignment[]>();
    files.forEach((file) => {
      const key = `${file.subjectId}_${file.sessionId || ""}_${file.task}`;
      const group = groups.get(key) || [];
      group.push(file);
      groups.set(key, group);
    });

    groups.forEach((groupFiles) => {
      if (groupFiles.length > 1) {
        groupFiles.forEach((file, index) => {
          updateFileAssignment(file.sourcePath, { run: index + 1 });
        });
      } else {
        updateFileAssignment(groupFiles[0].sourcePath, { run: undefined });
      }
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium">Assign to Subjects & Sessions</h3>
        <p className="text-sm text-muted-foreground">
          Map each file to a subject, session, task, and run number
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={addSubject}>
          <Plus className="h-3 w-3 mr-1" />
          Add Subject
        </Button>
        <Button variant="outline" size="sm" onClick={addSession}>
          <Plus className="h-3 w-3 mr-1" />
          Add Session
        </Button>
        <div className="border-l h-6 mx-2" />
        <Button variant="outline" size="sm" onClick={() => setAllTask("rest")}>
          Set all: rest
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAllTask("eyesclosed")}
        >
          Set all: eyesclosed
        </Button>
        <Button variant="outline" size="sm" onClick={autoNumberRuns}>
          Auto-number runs
        </Button>
      </div>

      <div className="border rounded-lg overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[200px]">File</TableHead>
              <TableHead className="w-32">Subject</TableHead>
              <TableHead className="w-32">Session</TableHead>
              <TableHead className="w-32">Task</TableHead>
              <TableHead className="w-20">Run</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.map((file) => (
              <TableRow key={file.sourcePath}>
                <TableCell className="font-medium">
                  <span className="truncate block max-w-[200px]">
                    {file.fileName}
                  </span>
                </TableCell>
                <TableCell>
                  <Select
                    value={file.subjectId}
                    onValueChange={(value) =>
                      updateFileAssignment(file.sourcePath, {
                        subjectId: value,
                      })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Subject" />
                    </SelectTrigger>
                    <SelectContent>
                      {uniqueSubjects.map((sub) => (
                        <SelectItem key={sub} value={sub}>
                          sub-{sub}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Select
                    value={file.sessionId || "__none__"}
                    onValueChange={(value) =>
                      updateFileAssignment(file.sourcePath, {
                        sessionId: value === "__none__" ? undefined : value,
                      })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {uniqueSessions.map((ses) => (
                        <SelectItem key={ses} value={ses}>
                          ses-{ses}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Input
                    value={file.task}
                    onChange={(e) =>
                      updateFileAssignment(file.sourcePath, {
                        task: e.target.value.replace(/[^a-zA-Z0-9]/g, ""),
                      })
                    }
                    placeholder="task"
                    className="w-full"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min={1}
                    value={file.run ?? ""}
                    onChange={(e) =>
                      updateFileAssignment(file.sourcePath, {
                        run: e.target.value
                          ? parseInt(e.target.value)
                          : undefined,
                      })
                    }
                    placeholder="—"
                    className="w-full"
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-sm text-muted-foreground">
        Tip: Leave &quot;Run&quot; empty for single recordings. Use run numbers
        only when you have multiple recordings of the same task for the same
        subject/session.
      </p>
    </div>
  );
}
