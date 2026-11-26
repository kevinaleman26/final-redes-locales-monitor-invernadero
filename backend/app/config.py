from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://invernadero:invernadero@localhost:5432/invernadero"
    rabbitmq_url: str = "amqp://invernadero:invernadero@localhost:5672/"
    queue_name: str = "sensor.readings"
    worker_prefetch: int = 50
    cors_origins: str = "*"
    # Configuración que se muestra en la página «Información» para los ESP32
    mqtt_public_host: str = ""  # IP o nombre .local del servidor visto desde la red local
    mqtt_public_port: int = 1883
    portal_ap_password: str = "invernadero"  # debe coincidir con AP_PASSWORD del firmware


settings = Settings()
