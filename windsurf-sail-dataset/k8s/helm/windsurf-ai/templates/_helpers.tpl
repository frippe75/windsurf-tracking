{{/*
Expand the name of the chart.
*/}}
{{- define "windsurf-ai.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "windsurf-ai.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "windsurf-ai.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "windsurf-ai.labels" -}}
helm.sh/chart: {{ include "windsurf-ai.chart" . }}
{{ include "windsurf-ai.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "windsurf-ai.selectorLabels" -}}
app.kubernetes.io/name: {{ include "windsurf-ai.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "windsurf-ai.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "windsurf-ai.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
GPU node selector for T4 nodes
*/}}
{{- define "windsurf-ai.nodeSelector" -}}
nvidia.com/gpu.product: Tesla-T4
kubernetes.io/arch: amd64
{{- end }}

{{/*
GPU tolerations for dedicated GPU nodes
*/}}
{{- define "windsurf-ai.tolerations" -}}
- key: nvidia.com/gpu
  operator: Exists
  effect: NoSchedule
{{- end }}