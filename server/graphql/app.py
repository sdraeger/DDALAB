"""GraphQL application configuration."""

import strawberry
from strawberry.fastapi import GraphQLRouter

from .context import Context, get_context
from .mutations import Mutation
from .queries import Query

# Create GraphQL schema and router
schema = strawberry.Schema(
    query=Query,
    mutation=Mutation,
)

graphql_app = GraphQLRouter[Context](
    schema,
    context_getter=get_context,
)
