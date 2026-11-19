"""Declaración de colas (debe coincidir con rabbitmq/definitions.template.json)."""
import aio_pika


async def declare_queues(channel: aio_pika.abc.AbstractChannel, queue_name: str):
    dlq_name = f"{queue_name}.dlq"
    await channel.declare_queue(dlq_name, durable=True)
    return await channel.declare_queue(
        queue_name,
        durable=True,
        arguments={
            # Mensajes rechazados (inválidos) se envían a la DLQ para inspección
            "x-dead-letter-exchange": "",
            "x-dead-letter-routing-key": dlq_name,
        },
    )
