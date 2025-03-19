"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FileBrowser } from "@/components/file-browser"
import { DDAForm } from "@/components/dda-form"
import { TaskStatus } from "@/components/task-status"
import { Card, CardContent } from "@/components/ui/card"

export function DashboardTabs() {
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState("files")

  const handleFileSelect = (filePath: string) => {
    setSelectedFilePath(filePath)
    setActiveTab("dda")
  }

  const handleTaskSubmitted = (taskId: string) => {
    setActiveTaskId(taskId)
    setActiveTab("tasks")
  }

  const handleTaskComplete = (results: any) => {
    // You could do something with the results here
    console.log("Task completed with results:", results)
  }

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList className="grid grid-cols-3 mb-8">
        <TabsTrigger value="files">Files</TabsTrigger>
        <TabsTrigger value="dda">DDA Analysis</TabsTrigger>
        <TabsTrigger value="tasks">Tasks</TabsTrigger>
      </TabsList>

      <TabsContent value="files" className="space-y-4">
        <FileBrowser onFileSelect={handleFileSelect} />
      </TabsContent>

      <TabsContent value="dda" className="space-y-4">
        {selectedFilePath ? (
          <DDAForm filePath={selectedFilePath} onTaskSubmitted={handleTaskSubmitted} />
        ) : (
          <Card>
            <CardContent className="pt-6">
              <p className="text-center text-muted-foreground">
                Please select a file from the Files tab to start a DDA analysis
              </p>
            </CardContent>
          </Card>
        )}
      </TabsContent>

      <TabsContent value="tasks" className="space-y-4">
        {activeTaskId ? (
          <TaskStatus taskId={activeTaskId} onComplete={handleTaskComplete} />
        ) : (
          <Card>
            <CardContent className="pt-6">
              <p className="text-center text-muted-foreground">
                No active tasks. Submit a DDA analysis to see task status here.
              </p>
            </CardContent>
          </Card>
        )}
      </TabsContent>
    </Tabs>
  )
}

