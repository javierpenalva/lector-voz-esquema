# Imagen para publicar el lector en un servicio de alojamiento (Render, Hugging Face Spaces, Fly.io…).
FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
COPY lector lector
COPY static static
# Definir en el panel del servicio (nunca aquí): LECTOR_CODIGO y, opcionalmente, ANTHROPIC_API_KEY.
ENV PORT=7860
EXPOSE 7860
CMD ["python", "app.py"]
