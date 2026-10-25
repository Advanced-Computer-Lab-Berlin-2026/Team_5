
import mongoose from 'mongoose';

//this is a dummy file till items are implemented in the database

const  ItemListingSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true
        }
    }
);



export const ItemListing = mongoose.model('ItemListing', ItemListingSchema);
